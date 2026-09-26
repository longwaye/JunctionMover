// JunctionMover 前端逻辑
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { t, getCurrentLang, setLang, toggleLang, applyI18n } from './i18n.js'
import pkg from '../package.json'

// 侧边栏版本号跟随 package.json，发版只改 package.json/tauri.conf.json/Cargo.toml
document.getElementById('logoVer').textContent = 'v' + pkg.version

const $ = (id) => document.getElementById(id)
const SCAN_CANCELLED = '__ps_cancelled__'

const state = {
	drives: [],
	dirs: [], // 扫描到的目录
	selected: new Map(), // 迁移任务：path -> dir item
	tasks: new Map(), // path -> task {name, status, detail, copy, lastStage}
	taskTargets: new Map(), // path -> 该任务的目标文件夹
	taskChecks: new Set(), // 任务面板/目录表中勾选的 path
	scanning: false,
	hasScanned: false, // 是否已执行过扫描（决定按钮文字"扫描"还是"重新扫描"）
	currentJob: null, // {kind:'migrate'|'rollback', index, total, label}
	dirSort: 'none', // 目录分析大小排序：none（扫描顺序）| desc（大→小）| asc（小→大）
	junctionView: 'tree', // 已迁移页视图：tree（按层级）| size（按大小）
	junctionSort: 'desc', // 已迁移大小视图排序：desc | asc
	junctionExpanded: new Set(), // 层级树中展开的文件夹节点（key = 累计目标路径）
	junctionSeen: new Set(), // 已初始化过展开状态的节点（重扫不覆盖用户的折叠选择）
	currentPanel: 'panel-drives', // 当前激活的面板，切换语言时据此重渲染顶栏标题
	currentStatus: { text: '', type: 'idle', key: null, params: null }, // 顶栏状态，支持按 key 重译
	currentScanPos: null, // 最近一次 scan-progress 事件 payload，切换语言时据此重渲染 #scanPos
	scanStopping: false, // 扫描正在停止（影响 #scanPos 显示文案）
}

// 层级树图标（内联 SVG，与整体 Fluent 风格一致）
const FOLDER_SVG =
	'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
const DRIVE_SVG =
	'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm3.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM7 7v4h12V7H7z"/></svg>'
const LINK_SVG =
	'<svg class="j-link-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/></svg>'

// ---------- 工具 ----------
function fmtSize(bytes) {
	if (bytes == null) return '-'
	if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB'
	if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
	if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB'
	return bytes + ' B'
}

// 扫描根 -> 位置显示名（Local / Roaming / 用户主目录点文件夹）
function rootLabel(root) {
	if (root === 'Local') return t('dirs.location_local')
	if (root === 'Roaming') return t('dirs.location_roaming')
	if (root === 'Home') return t('dirs.location_home')
	return root
}

function log(msg, level = 'info') {
	const box = $('logBox')
	const line = document.createElement('div')
	const ts = new Date().toLocaleTimeString(
		getCurrentLang() === 'zh' ? 'zh-CN' : 'en-US',
		{ hour12: false },
	)
	line.className = 'log-' + level
	line.textContent = `[${ts}] ${msg}`
	box.appendChild(line)
	box.scrollTop = box.scrollHeight
}

function dstPath(d) {
	const folder = state.taskTargets.get(d.path)
	return folder ? joinTarget(folder, d.basename) : null
}

// 后端 PROGRESS 阶段键 -> i18n key 映射；rawStage 形如 "copying" 或 "procs_found|a.exe, b.exe"
const STAGE_MAP = {
	check_space: 'stage.check_space',
	no_procs: 'stage.no_procs',
	procs_found: 'stage.procs_found',
	procs_closed: 'stage.procs_closed',
	copying: 'stage.copying',
	verifying: 'stage.verifying',
	deleting_src: 'stage.deleting_src',
	creating_junction: 'stage.creating_junction',
	copying_back: 'stage.copying_back',
	verifying_staging: 'stage.verifying_staging',
	removing_junction: 'stage.removing_junction',
	restoring_dir: 'stage.restoring_dir',
	done: 'stage.done',
}

function translateStage(rawStage) {
	const parts = rawStage.split('|')
	const key = STAGE_MAP[parts[0]]
	const text = key ? t(key) : parts[0]
	return parts.length > 1 ? `${text}: ${parts.slice(1).join('|')}` : text
}

// 拼接目标文件夹与源 basename：若 target 末段已与 basename 同名则直接返回 target，
// 避免 ...\\BraveSoftware\\BraveSoftware 这样的重复层级
function joinTarget(target, basename) {
	const sep = target.includes('/') ? '/' : '\\'
	const t = target.replace(/[\\/]+$/, '')
	const parts = t.split(/[\\/]/)
	if (parts[parts.length - 1].toLowerCase() === basename.toLowerCase()) {
		return t
	}
	return t + '\\' + basename
}

// 顶栏状态：记录翻译键以便切换语言时重新翻译。
// 调用方：setStatus(t('status.ready'), 'idle', 'status.ready')
// 不带 key 的纯文本调用也支持（切换语言时按原样重置，可能滞后至下一次状态变化）。
function setStatus(text, type = 'idle', key = null, params = null) {
	state.currentStatus = { text, type, key, params }
	const el = $('appStatus')
	el.innerHTML = `<span class="dot"></span>${escapeHtml(text)}`
	el.className = 'app-status ' + type
}

// ---------- 扫描 ----------
async function refreshDrives() {
	try {
		state.drives = await invoke('scan_drives')
		renderDrives()
		setStatus(t('status.ready'), 'idle', 'status.ready')
	} catch (e) {
		log(t('log.scan_disk_fail', { err: e }), 'err')
		setStatus(t('status.disk_scan_failed'), 'err', 'status.disk_scan_failed')
	}
}

function renderDrives() {
	const list = $('driveList')
	list.innerHTML = ''
	for (const d of state.drives) {
		const usedPct =
			d.total > 0 ? Math.round(((d.total - d.free) / d.total) * 100) : 0
		const card = document.createElement('div')
		card.className = 'drive-card'
		card.innerHTML = `
      <div class="name">${escapeHtml(d.name)}</div>
      <div class="cap">${fmtSize(d.total)} ${t('drives.card_total')}</div>
      <div class="bar"><div style="width:${usedPct}%"></div></div>
      <div class="free">${t('drives.card_free')} ${fmtSize(d.free)}</div>
      <div class="cap">${t('drives.card_used')} ${usedPct}%</div>
    `
		list.appendChild(card)
	}
}

// 弹出系统原生文件夹选择对话框，返回所选路径或 null（取消/失败）
async function pickFolder() {
	try {
		return await invoke('pick_target_folder')
	} catch (e) {
		log(t('tasks.pick_folder_err_log', { err: e }), 'err')
		return null
	}
}

async function refreshDirs() {
	state.dirs = []
	state.scanning = true
	state.currentScanPos = null
	state.scanStopping = false
	renderDirs()
	renderJunctions()
	const wrap = $('scanProgress')
	wrap.classList.remove('hidden')
	$('scanPos').textContent = t('dirs.preparing')
	$('btnScan').disabled = true
	$('btnStopScan').disabled = false
	setStatus(t('status.scanning'), 'busy', 'status.scanning')
	log(t('log.scan_start'))
	try {
		// 扫描结果以 scan-dir-item 事件逐条上屏；invoke 返回的是最终完整列表
		state.dirs = await invoke('scan_dirs')
		renderDirs()
		renderJunctions()
		log(t('log.scan_done', { n: state.dirs.length }), 'ok')
		const movableSize = state.dirs
			.filter((d) => d.movable && !d.is_junction)
			.reduce((s, d) => s + d.size, 0)
		setStatus(
			t('status.scan_done', {
				n: state.dirs.length,
				size: fmtSize(movableSize),
			}),
			'ok',
			'status.scan_done',
			{ n: state.dirs.length, size: fmtSize(movableSize) },
		)
	} catch (e) {
		if (String(e) === SCAN_CANCELLED) {
			renderDirs()
			renderJunctions()
			log(t('log.scan_stopped_kept', { n: state.dirs.length }), 'info')
			setStatus(t('status.scan_stopped'), 'idle', 'status.scan_stopped')
		} else {
			log(t('log.scan_dirs_fail', { err: e }), 'err')
			$('dirBody').innerHTML =
				`<tr><td colspan="6" class="empty">${escapeHtml(t('dirs.scan_failed_row', { msg: String(e) }))}</td></tr>`
			setStatus(t('status.scan_failed'), 'err', 'status.scan_failed')
		}
	} finally {
		state.scanning = false
		state.hasScanned = true
		wrap.classList.add('hidden')
		$('btnScan').disabled = false
		$('btnScan').textContent = t('dirs.rescan')
		$('btnStopScan').disabled = true
	}
}

async function stopScan() {
	$('btnStopScan').disabled = true
	state.scanStopping = true
	$('scanPos').textContent = t('dirs.stopping')
	try {
		await invoke('cancel_scan')
	} catch (e) {
		log(t('log.stop_scan_fail', { err: e }), 'err')
	}
}

function renderDirs() {
	const tbody = $('dirBody')
	tbody.innerHTML = ''
	const onlyMovable = $('onlyMovable').checked
	const onlyBig = $('onlyBig').checked
	// 安全推荐：大型缓存目录（软件可自动重建，迁移风险相对最低），按大小降序
	const onlySafeCache = $('onlySafeCache').checked
	const BIG = 200 * 1024 * 1024

	let list = state.dirs
	if (onlySafeCache) {
		list = list.filter(
			(d) =>
				d.movable && !d.is_junction && d.dir_type === 'cache' && d.size >= BIG,
		)
	}
	// 大小表头排序：desc 大→小 / asc 小→大；未指定时安全推荐视图默认按大小降序
	if (state.dirSort !== 'none') {
		const f = state.dirSort === 'desc' ? -1 : 1
		list = list.slice().sort((a, b) => (a.size - b.size) * f)
	} else if (onlySafeCache) {
		list = list.slice().sort((a, b) => b.size - a.size)
	}

	let shown = 0
	for (const d of list) {
		if (!onlySafeCache && onlyMovable && !d.movable) continue
		if (onlyBig && d.size < BIG) continue

		shown++
		const tr = document.createElement('tr')
		const isSelected = state.selected.has(d.path)
		// 仅可迁移的普通目录可勾选加入迁移任务；
		// Junction 请到"已迁移 / 回滚"页面操作，不建议迁移的目录禁用
		const disabled = d.movable && !d.is_junction ? '' : 'disabled'
		const checkTitle = d.is_junction
			? ` title="${escapeHtml(t('dirs.check_title_junction'))}"`
			: ''

		tr.innerHTML = `
      <td${checkTitle}><input type="checkbox" class="row-check" data-path="${escapeHtml(d.path)}" ${isSelected ? 'checked' : ''} ${disabled} /></td>
      <td><span class="dir-link" data-path="${escapeHtml(d.path)}" title="${escapeHtml(d.path)}">${escapeHtml(d.name)}</span></td>
      <td>${rootLabel(d.root)}</td>
      <td class="size">${fmtSize(d.size)}</td>
      <td>${typeBadge(d)}</td>
      <td class="state">${stateBadge(d)}</td>
    `
		tbody.appendChild(tr)
	}
	$('dirEmpty').classList.toggle('hidden', shown > 0)
	$('statText').textContent = onlySafeCache
		? t('dirs.stat_safe', { n: shown })
		: t('dirs.stat_normal', { total: state.dirs.length, n: shown })
	$('btnAddTasks').disabled = state.selected.size === 0
	updateDirSortHeader()
	bindRows()
}

// 点击目录名在资源管理器中打开
$('dirBody').addEventListener('click', (e) => {
	const link = e.target.closest('.dir-link')
	if (!link) return
	invoke('open_folder', { path: link.dataset.path }).catch((err) =>
		log(t('log.open_folder_err_detail', { err }), 'err'),
	)
})

// 大小表头的排序方向指示：⇅ 未排序 / ↓ 大→小 / ↑ 小→大
function updateDirSortHeader() {
	const th = $('thSize')
	const arrow = $('dirSortArrow')
	if (!th || !arrow) return
	th.classList.toggle('sorted', state.dirSort !== 'none')
	arrow.textContent =
		state.dirSort === 'asc' ? '↑' : state.dirSort === 'desc' ? '↓' : '⇅'
}

function escapeHtml(s) {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function typeBadge(d) {
	if (d.is_junction)
		return `<span class="badge badge-blue">${escapeHtml(t('junc.migrated_junction_badge'))}</span>`
	switch (d.dir_type) {
		case 'cache':
			return `<span class="badge badge-yellow">${escapeHtml(t('type.cache'))}</span>`
		case 'data':
			return `<span class="badge badge-green">${escapeHtml(t('type.app_data'))}</span>`
		case 'config':
			return `<span class="badge badge-gray">${escapeHtml(t('type.config'))}</span>`
		case 'system':
			return `<span class="badge badge-red">${escapeHtml(t('type.system_caution'))}</span>`
		default:
			return `<span class="badge badge-gray">${escapeHtml(t('type.unknown'))}</span>`
	}
}

function stateBadge(d) {
	if (d.is_junction)
		return `<span class="badge badge-green">${escapeHtml(t('state.migrated'))}</span>`
	if (!d.movable)
		return `<span class="badge badge-gray">${escapeHtml(t('state.not_recommended'))}</span>`
	if (d.dir_type === 'cache')
		return `<span class="badge badge-yellow">${escapeHtml(t('state.movable'))}</span>`
	return `<span class="badge badge-green">${escapeHtml(t('state.movable'))}</span>`
}

function bindRows() {
	document.querySelectorAll('.row-check').forEach((cb) => {
		cb.addEventListener('change', () => {
			const p = cb.dataset.path
			const d = state.dirs.find((x) => x.path === p)
			if (!d) return
			// 目录分析里勾选 = 添加到迁移任务，取消勾选 = 移出任务
			if (cb.checked) {
				state.selected.set(p, d)
				state.taskChecks.add(p)
			} else {
				state.selected.delete(p)
				state.taskChecks.delete(p)
				state.taskTargets.delete(p)
				state.tasks.delete(p)
			}
			renderDirs()
			updateTaskList()
		})
	})
}

// 操作结论详情行：成功绿色、失败红色（status 是徽章 HTML，据此判定）
function taskDetailHtml(t) {
	const cls =
		t.status && t.status.includes('badge-green')
			? 'is-ok'
			: t.status && t.status.includes('badge-red')
				? 'is-err'
				: ''
	return `<div class="task-detail ${cls}">${escapeHtml(t.detail)}</div>`
}

// ---------- 任务列表 ----------
function updateTaskList() {
	const list = $('taskList')
	const btnMigrate = $('btnMigrate')
	const btnBatch = $('btnBatchTarget')
	list.innerHTML = ''
	if (state.selected.size === 0) {
		list.innerHTML = `<div class="empty">${escapeHtml(t('tasks.empty'))}</div>`
		btnMigrate.disabled = true
		btnBatch.disabled = true
		$('taskHint').textContent = ''
		$('btnAddTasks').disabled = true
		return
	}
	$('btnAddTasks').disabled = false

	let movableReady = 0 // 勾选且已设目标、可迁移
	let movableNoTarget = 0 // 勾选但未设目标
	for (const [path, d] of state.selected) {
		const item = document.createElement('div')
		item.className = 'task-item'
		item.dataset.path = path
		const taskEntry = state.tasks.get(path)
		const checked = state.taskChecks.has(path)
		const dst = dstPath(d)
		// 每个任务展示：源位置 -> 实际迁移位置（目标文件夹\目录名）
		const routeHtml = `<div class="task-route">
      <span class="route-src" title="${escapeHtml(d.path)}">${escapeHtml(t('tasks.route_src', { path: d.path }))}</span>
      <span class="route-arrow">→</span>
      <span class="route-dst ${dst ? '' : 'no-target'}" title="${dst ? escapeHtml(dst) : ''}">${dst ? escapeHtml(t('tasks.route_dst', { path: dst })) : escapeHtml(t('tasks.no_target'))}</span>
      <button class="btn btn-sm btn-ghost task-set-target" data-path="${escapeHtml(path)}">${dst ? escapeHtml(t('tasks.change')) : escapeHtml(t('tasks.set_folder'))}</button>
    </div>`
		// 进行中的复制进度条
		const progHtml =
			taskEntry && taskEntry.copy
				? `<div class="task-prog">
           <div class="mini-bar"><div style="width:${taskEntry.copy.pct}%"></div></div>
           <span class="prog-text">${escapeHtml(
							t('tasks.prog_text', {
								pct: taskEntry.copy.pct,
								done: taskEntry.copy.filesDone,
								total: taskEntry.copy.filesTotal,
								bytesDone: fmtSize(taskEntry.copy.bytesDone),
								bytesTotal: fmtSize(taskEntry.copy.bytesTotal),
							}),
						)}</span>
         </div>`
				: ''
		// 操作结束后展示后端结论：原目录是否删除、联接是否建立
		const detailHtml =
			taskEntry && taskEntry.detail && !taskEntry.copy
				? taskDetailHtml(taskEntry)
				: ''
		item.innerHTML = `
      <input type="checkbox" class="task-check" data-path="${escapeHtml(path)}" ${checked ? 'checked' : ''} />
      <span class="t-name">${escapeHtml(d.name)} <span class="cap">(${fmtSize(d.size)})</span></span>
      <span class="t-status">${taskEntry ? taskEntry.status : stateBadge(d)}</span>
      <button class="btn btn-sm btn-ghost task-remove" data-path="${escapeHtml(path)}" title="${escapeHtml(t('tasks.remove_title'))}">${escapeHtml(t('tasks.remove'))}</button>
      ${routeHtml}
      ${progHtml}
      ${detailHtml}
    `
		list.appendChild(item)

		if (checked) {
			if (dst) movableReady++
			else movableNoTarget++
		}
	}

	btnBatch.disabled = state.taskChecks.size === 0
	btnMigrate.disabled = movableReady === 0
	const hints = []
	if (movableReady) hints.push(t('tasks.hint_movable', { n: movableReady }))
	if (movableNoTarget)
		hints.push(t('tasks.hint_no_target', { n: movableNoTarget }))
	$('taskHint').textContent = hints.join(t('tasks.hint_join'))

	bindTaskRows()
}

function bindTaskRows() {
	document.querySelectorAll('.task-check').forEach((cb) => {
		cb.addEventListener('change', () => {
			if (cb.checked) state.taskChecks.add(cb.dataset.path)
			else state.taskChecks.delete(cb.dataset.path)
			updateTaskList()
		})
	})
	document.querySelectorAll('.task-set-target').forEach((btn) => {
		btn.addEventListener('click', async () => {
			const p = btn.dataset.path
			btn.disabled = true
			const folder = await pickFolder()
			if (folder) {
				state.taskTargets.set(p, folder)
				const d = state.selected.get(p)
				log(t('tasks.target_set_log', { name: d ? d.name : p, folder }), 'info')
			}
			updateTaskList()
		})
	})
	document.querySelectorAll('.task-remove').forEach((btn) => {
		btn.addEventListener('click', () => {
			const p = btn.dataset.path
			const d = state.selected.get(p)
			// 仅移出任务列表，不碰磁盘；再次添加需到目录分析重新勾选
			state.selected.delete(p)
			state.taskChecks.delete(p)
			state.taskTargets.delete(p)
			state.tasks.delete(p)
			if (d) log(t('tasks.removed_log', { name: d.name }), 'info')
			renderDirs()
			updateTaskList()
		})
	})
}

// ---------- 已迁移 / 回滚 ----------
// 单个已迁移联接的卡片内容（层级树叶子与大小视图扁平列表共用）
function junctionLeafHtml(d) {
	const taskEntry = state.tasks.get(d.path)
	const rollbackIngText = t('junc.rollback_ing')
	const running =
		taskEntry &&
		((taskEntry.status && taskEntry.status.indexOf(rollbackIngText) >= 0) ||
			taskEntry.copy)
	const progHtml =
		taskEntry && taskEntry.copy
			? `<div class="task-prog">
         <div class="task-prog-head">
           <span class="task-prog-pct">${taskEntry.copy.pct}%</span>
           <span class="task-prog-detail">${escapeHtml(
							t('copy.progress_detail', {
								done: taskEntry.copy.filesDone,
								total: taskEntry.copy.filesTotal,
								bytesDone: fmtSize(taskEntry.copy.bytesDone),
								bytesTotal: fmtSize(taskEntry.copy.bytesTotal),
							}),
						)}</span>
         </div>
         <div class="mini-bar"><div style="width:${taskEntry.copy.pct}%"></div></div>
       </div>`
			: ''
	// 回滚结束后展示：C 盘是否已恢复、联接是否移除、目标盘旧数据是否删除
	const detailHtml =
		taskEntry && taskEntry.detail && !taskEntry.copy
			? taskDetailHtml(taskEntry)
			: ''
	return `
    <span class="t-name"><span class="dir-link" data-path="${escapeHtml(d.target || d.path)}" title="${escapeHtml(d.target || d.path)}">${LINK_SVG}${escapeHtml(d.name)}</span> <span class="cap">(${fmtSize(d.size)})</span></span>
    <span class="t-status">${taskEntry ? taskEntry.status : `<span class="badge badge-blue">${escapeHtml(t('junc.migrated_badge'))}</span>`}</span>
    <button class="btn btn-sm btn-danger rb-btn" data-path="${escapeHtml(d.path)}" ${running ? 'disabled' : ''}>${running ? escapeHtml(t('junc.rollback_ing')) : escapeHtml(t('junc.rollback'))}</button>
    <div class="task-route">
      <span class="route-src dir-link" data-path="${escapeHtml(d.path)}" title="${escapeHtml(d.path)}">${escapeHtml(t('junc.c_junction_detail', { path: d.path }))}</span>
      <span class="route-arrow">→</span>
      <span class="route-dst dir-link" data-path="${escapeHtml(d.target || '')}" title="${escapeHtml(d.target || '')}">${escapeHtml(t('junc.data_location_detail', { path: d.target || t('junc.unknown') }))}</span>
    </div>
    ${progHtml}
    ${detailHtml}
  `
}

// 大小视图的卡片：排名徽标 + 名称/状态 + 右侧醒目大小 + 回滚按钮，路径信息下沉为浅色副行
function junctionSizeCardHtml(d, rank) {
	const taskEntry = state.tasks.get(d.path)
	const rollbackIngText = t('junc.rollback_ing')
	const running =
		taskEntry &&
		((taskEntry.status && taskEntry.status.indexOf(rollbackIngText) >= 0) ||
			taskEntry.copy)
	const progHtml =
		taskEntry && taskEntry.copy
			? `<div class="task-prog">
         <div class="task-prog-head">
           <span class="task-prog-pct">${taskEntry.copy.pct}%</span>
           <span class="task-prog-detail">${escapeHtml(
							t('copy.progress_detail', {
								done: taskEntry.copy.filesDone,
								total: taskEntry.copy.filesTotal,
								bytesDone: fmtSize(taskEntry.copy.bytesDone),
								bytesTotal: fmtSize(taskEntry.copy.bytesTotal),
							}),
						)}</span>
         </div>
         <div class="mini-bar"><div style="width:${taskEntry.copy.pct}%"></div></div>
       </div>`
			: ''
	const detailHtml =
		taskEntry && taskEntry.detail && !taskEntry.copy
			? taskDetailHtml(taskEntry)
			: ''
	return `
    <div class="js-rank ${rank <= 3 ? 'top' : ''}">${rank}</div>
    <div class="js-main">
      <div class="js-head">
        <span class="js-name"><span class="dir-link" data-path="${escapeHtml(d.target || d.path)}" title="${escapeHtml(d.target || d.path)}">${LINK_SVG}${escapeHtml(d.name)}</span>
          <span class="js-badge">${taskEntry ? taskEntry.status : `<span class="badge badge-blue">${escapeHtml(t('junc.migrated_badge'))}</span>`}</span>
        </span>
        <span class="js-actions">
          <span class="js-size">${fmtSize(d.size)}</span>
          <button class="btn btn-sm btn-danger rb-btn" data-path="${escapeHtml(d.path)}" ${running ? 'disabled' : ''}>${running ? escapeHtml(t('junc.rollback_ing')) : escapeHtml(t('junc.rollback'))}</button>
        </span>
      </div>
      <div class="js-route">
        <span class="route-src dir-link" data-path="${escapeHtml(d.path)}" title="${escapeHtml(d.path)}">${escapeHtml(t('junc.c_junction_size', { path: d.path }))}</span>
        <span class="route-arrow">→</span>
        <span class="route-dst dir-link" data-path="${escapeHtml(d.target || '')}" title="${escapeHtml(d.target || '')}">${escapeHtml(t('junc.data_location_detail', { path: d.target || t('junc.unknown') }))}</span>
      </div>
      ${progHtml}
      ${detailHtml}
    </div>`
}

// 以数据实际存放路径（target）分段建树：
// E:\C_AppData\Local\Google\Chrome\User Data\Profile 17 -> 盘>根>应用>...>联接叶子
function buildJunctionTree(links) {
	const root = { name: '', id: '', depth: -1, children: new Map(), leaf: null }
	for (const d of links) {
		const parts = String(d.target || '')
			.split(/[\\/]+/)
			.filter(Boolean)
		let node = root
		parts.forEach((seg, i) => {
			let child = node.children.get(seg)
			if (!child) {
				child = {
					name: seg,
					id: parts.slice(0, i + 1).join('\\'),
					depth: i,
					children: new Map(),
					leaf: null,
				}
				node.children.set(seg, child)
			}
			if (i === parts.length - 1) child.leaf = d
			node = child
		})
	}
	// 转数组并后序聚合（文件夹大小 = 其下全部已迁移联接之和）
	const finalize = (n) => {
		n.childList = [...n.children.values()].map(finalize)
		n.leafCount =
			n.childList.reduce((s, c) => s + c.leafCount, 0) + (n.leaf ? 1 : 0)
		n.aggSize =
			n.childList.reduce((s, c) => s + c.aggSize, 0) +
			(n.leaf ? n.leaf.size || 0 : 0)
		return n
	}
	return finalize(root)
}

// 递归渲染树：节点 = 文件夹行（可展开）+ 可选联接叶子卡片；
// 子层放在 .j-children 中，由 CSS 统一缩进并画虚线引导，保证行与图标严格对齐
function renderJunctionTree(container, node) {
	for (const child of node.childList) {
		// 首次见到的前三层文件夹（盘符\迁移根\Local|Roaming）默认展开，之后尊重用户的折叠选择
		if (!state.junctionSeen.has(child.id)) {
			state.junctionSeen.add(child.id)
			if (child.depth < 3) state.junctionExpanded.add(child.id)
		}
		const open = state.junctionExpanded.has(child.id)
		const nodeEl = document.createElement('div')
		nodeEl.className = 'j-node'

		if (child.childList.length > 0) {
			const row = document.createElement('div')
			row.className =
				'j-frow' + (open ? ' open' : '') + (child.depth === 0 ? ' is-root' : '')
			row.dataset.jfolder = child.id
			row.title = child.id
			row.innerHTML = `
        <span class="caret"></span>
        <span class="f-ico">${child.depth === 0 ? DRIVE_SVG : FOLDER_SVG}</span>
        <span class="f-name dir-link" data-path="${escapeHtml(child.id)}" title="${escapeHtml(child.id)}">${escapeHtml(child.name)}</span>
        <span class="f-agg">${escapeHtml(t('junc.tree_agg', { size: fmtSize(child.aggSize), n: child.leafCount }))}</span>`
			nodeEl.appendChild(row)
			if (open) {
				const childrenEl = document.createElement('div')
				childrenEl.className = 'j-children'
				nodeEl.appendChild(childrenEl)
				renderJunctionTree(childrenEl, child)
			}
		}
		// 节点本身也可能是联接（同名目录被迁移且其下还有其他被迁移目录的情况）
		if (child.leaf) {
			const lrow = document.createElement('div')
			lrow.className = 'j-lrow'
			const card = document.createElement('div')
			card.className = 'task-item'
			card.innerHTML = junctionLeafHtml(child.leaf)
			lrow.appendChild(card)
			nodeEl.appendChild(lrow)
		}
		container.appendChild(nodeEl)
	}
}

function renderJunctions() {
	const list = $('junctionList')
	if (!list) return
	const links = state.dirs.filter((d) => d.is_junction)
	$('junctionEmpty').classList.toggle('hidden', links.length > 0)
	$('jvTree').classList.toggle('active', state.junctionView === 'tree')
	$('jvSize').classList.toggle('active', state.junctionView === 'size')
	$('jSortSeg').classList.toggle(
		'hidden',
		state.junctionView !== 'size' || links.length === 0,
	)
	$('jsDesc').classList.toggle('active', state.junctionSort === 'desc')
	$('jsAsc').classList.toggle('active', state.junctionSort === 'asc')
	$('junctionStat').textContent = links.length
		? t('junc.stat', { n: links.length })
		: ''
	list.innerHTML = ''
	if (links.length === 0) return

	if (state.junctionView === 'tree') {
		// 层级视图：按数据存放路径逐层归类，点开文件夹查看下一层
		list.classList.remove('js-list')
		const tree = buildJunctionTree(links)
		renderJunctionTree(list, tree)
	} else {
		// 大小视图：扁平排序 + 排名/醒目大小，方便直接找最大的已迁移目录
		list.classList.add('js-list')
		const f = state.junctionSort === 'desc' ? -1 : 1
		links
			.slice()
			.sort((a, b) => (a.size - b.size) * f)
			.forEach((d, i) => {
				const card = document.createElement('div')
				card.className = 'js-card'
				card.innerHTML = junctionSizeCardHtml(d, i + 1)
				list.appendChild(card)
			})
	}
	list.querySelectorAll('.rb-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			const d = state.dirs.find(
				(x) => x.path === btn.dataset.path && x.is_junction,
			)
			if (d) rollbackOne(d)
		})
	})
}

// 为所有勾选任务统一设置同一个目标文件夹
async function batchSetTargets() {
	const paths = [...state.taskChecks].filter((p) => state.selected.has(p))
	if (paths.length === 0) return
	const folder = await pickFolder()
	if (!folder) return
	for (const p of paths) state.taskTargets.set(p, folder)
	log(t('tasks.batch_set_log', { n: paths.length, folder }), 'info')
	updateTaskList()
}

// ---------- 迁移 ----------
async function startMigration() {
	// 仅迁移：已勾选、非 Junction、且已单独/批量设置目标文件夹的任务
	const items = [...state.selected.values()].filter(
		(d) =>
			!d.is_junction &&
			state.taskChecks.has(d.path) &&
			state.taskTargets.has(d.path),
	)
	const noTarget = [...state.selected.values()].filter(
		(d) =>
			!d.is_junction &&
			state.taskChecks.has(d.path) &&
			!state.taskTargets.has(d.path),
	)
	if (items.length === 0) {
		log(t('tasks.no_movable'), 'info')
		return
	}
	for (const d of noTarget) {
		log(t('tasks.skipped_no_target', { name: d.name }), 'info')
	}

	$('progressWrap').classList.remove('hidden')
	$('btnMigrate').disabled = true
	setStatus(
		t('status.migrating_short', { i: 0, n: items.length }),
		'busy',
		'status.migrating_short',
		{ i: 0, n: items.length },
	)

	let okCount = 0
	for (let i = 0; i < items.length; i++) {
		const d = items[i]
		const target = state.taskTargets.get(d.path)
		const label = t('tasks.migrate_progress_label', {
			i: i + 1,
			n: items.length,
			name: d.name,
		})
		state.currentJob = {
			kind: 'migrate',
			index: i,
			total: items.length,
			label,
		}
		state.tasks.set(d.path, {
			name: d.name,
			status: `<span class="badge badge-yellow">${escapeHtml(t('tasks.migrating_badge'))}</span>`,
			detail: '',
			copy: null,
			lastStage: null,
		})
		setStatus(
			t('status.migrating', { i: i + 1, n: items.length, name: d.name }),
			'busy',
			'status.migrating',
			{ i: i + 1, n: items.length, name: d.name },
		)
		updateTaskList()
		setProgress('migrate', (i / items.length) * 100, label)

		try {
			log(
				t('tasks.migrate_start_log', {
					name: d.name,
					src: d.path,
					dst: joinTarget(target, d.basename),
				}),
			)
			const result = await invoke('migrate_dir', {
				src: d.path,
				targetDir: target,
			})
			const ok = result.success
			state.tasks.set(d.path, {
				name: d.name,
				status: ok
					? `<span class="badge badge-green">${escapeHtml(t('tasks.migrated_ok_badge'))}</span>`
					: `<span class="badge badge-red">${escapeHtml(t('tasks.failed_badge', { msg: result.message || t('type.unknown') }))}</span>`,
				detail: result.message,
			})
			log(
				t('tasks.migrate_result_log', {
					icon: ok ? '✓' : '✗',
					name: d.name,
					msg: result.message,
				}),
				ok ? 'ok' : 'err',
			)
			if (ok) {
				okCount++
				// 本地增量更新：复制经文件数/字节数校验一致后才会建联接成功，
				// 因此 size/files 沿用扫描值即可，无需触发整盘重新扫描
				d.is_junction = true
				d.movable = false
				d.target = joinTarget(target, d.basename)
				state.selected.delete(d.path)
				state.taskChecks.delete(d.path)
				state.taskTargets.delete(d.path)
			}
		} catch (e) {
			state.tasks.set(d.path, {
				name: d.name,
				status: `<span class="badge badge-red">${escapeHtml(t('tasks.error_badge'))}</span>`,
				detail: String(e),
			})
			log(t('tasks.migrate_exception_log', { name: d.name, err: e }), 'err')
		}
		updateTaskList()
	}
	state.currentJob = null
	setProgress(
		'migrate',
		100,
		okCount > 0
			? t('tasks.migrate_done_summary', { ok: okCount, n: items.length })
			: t('tasks.migrate_all_failed'),
	)
	setStatus(
		okCount > 0
			? t('status.migrate_done', { ok: okCount, n: items.length })
			: t('status.migrate_failed'),
		okCount > 0 ? 'ok' : 'err',
		okCount > 0 ? 'status.migrate_done' : 'status.migrate_failed',
		okCount > 0 ? { ok: okCount, n: items.length } : null,
	)
	setTimeout(() => $('progressWrap').classList.add('hidden'), 1200)
	// 成功项已在本地把目录标记为 Junction（target/大小沿用扫描值），直接重渲染两个页面，
	// 不再打断式全量重扫；外部手动改动可由用户在目录分析页点「重新扫描」发现
	updateTaskList()
	renderDirs()
	renderJunctions()
	if (okCount > 0) {
		log(t('tasks.migrate_updated_log', { n: okCount }), 'info')
	}
}

function setProgress(kind, pct, text) {
	if (kind === 'rollback') {
		$('rbProgressFill').style.width = pct + '%'
		$('rbProgressText').textContent = text
	} else {
		$('progressFill').style.width = pct + '%'
		$('progressText').textContent = text
	}
}

// 复制数值事件不带文字，由前端按事件类型映射徽章文案（这里只存 i18n key）
const COPY_STAGE_TEXT_KEY = {
	'migrate-progress': 'copy.stage_copy_data',
	'rollback-progress': 'copy.stage_copy_back',
}

// 统一处理迁移/回滚进度：阶段切换写日志；COPY 数值事件每 700ms 刷新进度条
function onTaskProgress(eventName, payload) {
	const { path, stage, copy } = payload
	const taskEntry = state.tasks.get(path)
	if (!taskEntry) return
	if (copy) {
		taskEntry.copy = copy
		const stageText = COPY_STAGE_TEXT_KEY[eventName]
			? t(COPY_STAGE_TEXT_KEY[eventName])
			: t('copy.stage_default')
		taskEntry.status = `<span class="badge badge-yellow">${escapeHtml(stageText)} ${copy.pct}%</span>`
		// 联动底部总进度条：已完成任务 + 当前任务内部百分比
		const job = state.currentJob
		if (job) {
			const overall = ((job.index + copy.pct / 100) / job.total) * 100
			setProgress(
				job.kind,
				overall,
				t('copy.overall_progress', {
					i: job.index + 1,
					n: job.total,
					pct: copy.pct,
					filesDone: copy.filesDone,
					filesTotal: copy.filesTotal,
					bytesDone: fmtSize(copy.bytesDone),
					bytesTotal: fmtSize(copy.bytesTotal),
				}),
			)
		}
	} else {
		// 阶段切换：清复制条、换徽章、日志留痕（同阶段不重复记）
		taskEntry.copy = null
		taskEntry.status = `<span class="badge badge-yellow">${escapeHtml(translateStage(stage))}</span>`
		if (taskEntry.lastStage !== stage) {
			taskEntry.lastStage = stage
			log(`[${taskEntry.name}] ${translateStage(stage)}`)
			const job = state.currentJob
			if (job)
				setProgress(
					job.kind,
					(job.index / job.total) * 100,
					`${job.label} — ${translateStage(stage)}`,
				)
		}
	}
	updateTaskList()
	renderJunctions()
}

// ---------- 回滚（在"已迁移 / 回滚"页面单个触发）----------
async function rollbackOne(d) {
	log(t('tasks.rollback_start_log', { name: d.name, path: d.path }))
	const label = t('tasks.rollback_label', { name: d.name })
	state.currentJob = { kind: 'rollback', index: 0, total: 1, label }
	state.tasks.set(d.path, {
		name: d.name,
		status: `<span class="badge badge-yellow">${escapeHtml(t('tasks.rollback_ing_badge'))}</span>`,
		detail: '',
		copy: null,
		lastStage: null,
	})
	$('rbProgressWrap').classList.remove('hidden')
	setStatus(
		t('status.rolling_back', { name: d.name }),
		'busy',
		'status.rolling_back',
		{ name: d.name },
	)
	renderJunctions()
	setProgress('rollback', 0, label)
	let ok = false
	try {
		const result = await invoke('rollback_dir', {
			linkPath: d.path,
			target: d.target,
		})
		ok = result.success
		state.tasks.set(d.path, {
			name: d.name,
			status: ok
				? `<span class="badge badge-gray">${escapeHtml(t('tasks.rolled_back_badge'))}</span>`
				: `<span class="badge badge-red">${escapeHtml(t('tasks.failed_badge', { msg: result.message || t('type.unknown') }))}</span>`,
			detail: result.message,
		})
		log(
			t('tasks.rollback_result_log', {
				icon: ok ? '✓' : '✗',
				name: d.name,
				msg: result.message,
			}),
			ok ? 'ok' : 'err',
		)
		if (ok) {
			// 本地增量更新：联接已移除、数据已恢复到 C 盘原路径，大小不变，无需全量重扫
			d.is_junction = false
			d.movable = true
			d.target = ''
		}
	} catch (e) {
		state.tasks.set(d.path, {
			name: d.name,
			status: `<span class="badge badge-red">${escapeHtml(t('tasks.error_rollback_badge', { msg: String(e) }))}</span>`,
			detail: String(e),
		})
		log(t('tasks.rollback_exception_log', { name: d.name, err: e }), 'err')
	}
	state.currentJob = null
	setProgress(
		'rollback',
		100,
		ok ? t('tasks.rollback_done_text') : t('tasks.rollback_failed_text'),
	)
	setStatus(
		ok ? t('status.rollback_done') : t('status.rollback_failed'),
		ok ? 'ok' : 'err',
		ok ? 'status.rollback_done' : 'status.rollback_failed',
	)
	if (!ok) $('rbProgressWrap').classList.add('hidden')
	if (ok) {
		// 回滚成功：从已迁移列表移除，立即在目录分析页出现
		state.dirs = state.dirs.filter((x) => x.path !== d.path)
		state.tasks.delete(d.path)
		$('rbProgressWrap').classList.add('hidden')
	}
	renderDirs()
	renderJunctions()
}

// ---------- 面板切换 ----------
// 顶栏标题用 i18n key（nav.*），切换语言时据此重渲染
const PANEL_TITLE_KEYS = {
	'panel-drives': 'nav.drives',
	'panel-dirs': 'nav.dirs',
	'panel-tasks': 'nav.tasks',
	'panel-junctions': 'nav.junctions',
	'panel-logs': 'nav.logs',
}

function switchPanel(panelId) {
	state.currentPanel = panelId
	document
		.querySelectorAll('.nav-item')
		.forEach((n) => n.classList.toggle('active', n.dataset.panel === panelId))
	document
		.querySelectorAll('.panel')
		.forEach((p) => p.classList.toggle('hidden', p.id !== panelId))
	const titleKey = PANEL_TITLE_KEYS[panelId]
	$('appbarTitle').textContent = titleKey ? t(titleKey) : ''
	if (panelId === 'panel-tasks') updateTaskList()
	if (panelId === 'panel-junctions') renderJunctions()
	if (panelId === 'panel-drives') refreshDrives()
}

// ---------- 事件绑定 ----------
document.querySelectorAll('.nav-item').forEach((n) => {
	n.addEventListener('click', () => switchPanel(n.dataset.panel))
})

// 顶栏语言切换按钮：在 en / zh 之间切换，并重渲染动态文本
$('langToggle').addEventListener('click', () => {
	toggleLang()
	reapplyDynamicI18n()
})

listen('scan-progress', (event) => {
	const { root, name } = event.payload
	if (name === 'done') return
	state.currentScanPos = { root, name }
	state.scanStopping = false
	const loc = rootLabel(root)
	$('scanPos').textContent = `${loc}\\${name}`
}).catch((e) => log(t('log.listen_progress_fail', { err: e }), 'err'))

// 扫描到一个目录就立即追加到表格下方
listen('scan-dir-item', (event) => {
	if (!state.scanning) return
	const d = event.payload
	if (d && d.path && !state.dirs.some((x) => x.path === d.path)) {
		state.dirs.push(d)
		renderDirs()
		renderJunctions()
	}
}).catch((e) => log(t('log.listen_dir_item_fail', { err: e }), 'err'))

listen('migrate-progress', (event) =>
	onTaskProgress('migrate-progress', event.payload),
).catch((e) => log(t('log.listen_migrate_fail', { err: e }), 'err'))

listen('rollback-progress', (event) =>
	onTaskProgress('rollback-progress', event.payload),
).catch((e) => log(t('log.listen_rollback_fail', { err: e }), 'err'))

$('btnScan').addEventListener('click', refreshDirs)
$('btnStopScan').addEventListener('click', stopScan)
$('btnAddTasks').addEventListener('click', () => switchPanel('panel-tasks'))
$('btnBatchTarget').addEventListener('click', batchSetTargets)
$('btnMigrate').addEventListener('click', startMigration)
$('onlyMovable').addEventListener('change', renderDirs)
$('onlyBig').addEventListener('change', renderDirs)
$('onlySafeCache').addEventListener('change', renderDirs)
$('btnClearLog').addEventListener('click', () => {
	$('logBox').innerHTML = ''
})

// 目录分析：点大小表头在 大→小 / 小→大 间切换（首次点击为大→小）
$('thSize').addEventListener('click', () => {
	state.dirSort = state.dirSort === 'desc' ? 'asc' : 'desc'
	renderDirs()
})

// 已迁移页：层级 / 大小 双视图切换
$('jvTree').addEventListener('click', () => {
	state.junctionView = 'tree'
	renderJunctions()
})
$('jvSize').addEventListener('click', () => {
	state.junctionView = 'size'
	renderJunctions()
})
// 大小视图：分段控件直接选择 大→小 / 小→大
$('jsDesc').addEventListener('click', () => {
	state.junctionSort = 'desc'
	renderJunctions()
})
$('jsAsc').addEventListener('click', () => {
	state.junctionSort = 'asc'
	renderJunctions()
})
// 层级树：文件夹行展开/折叠（事件委托，容器随 render 重建也无需重绑）
// .dir-link 点击打开资源管理器，不触发展开/折叠
$('junctionList').addEventListener('click', (e) => {
	const link = e.target.closest('.dir-link')
	if (link) {
		e.stopPropagation()
		invoke('open_folder', { path: link.dataset.path }).catch((err) =>
			log(t('log.open_folder_err_detail', { err }), 'err'),
		)
		return
	}
	const folder = e.target.closest('[data-jfolder]')
	if (!folder || !$('junctionList').contains(folder)) return
	const id = folder.dataset.jfolder
	if (state.junctionExpanded.has(id)) state.junctionExpanded.delete(id)
	else state.junctionExpanded.add(id)
	renderJunctions()
})

// 切换语言后重渲染所有动态文本：
// - 顶栏标题（按当前面板）
// - 顶栏状态（按缓存的 key/params 重译）
// - 扫描位置（按缓存的事件 payload 重译）
// - 各列表（renderDirs / renderJunctions / updateTaskList / renderDrives）
function reapplyDynamicI18n() {
	const titleKey = PANEL_TITLE_KEYS[state.currentPanel]
	if (titleKey) $('appbarTitle').textContent = t(titleKey)
	const cs = state.currentStatus
	if (cs) {
		if (cs.key) {
			setStatus(t(cs.key, cs.params || {}), cs.type, cs.key, cs.params)
		} else if (cs.text) {
			setStatus(cs.text, cs.type)
		}
	}
	// 扫描位置：停止中显示「正在停止...」；扫描中按最近事件 payload 重译
	if (state.scanStopping) {
		$('scanPos').textContent = t('dirs.stopping')
	} else if (state.currentScanPos) {
		const { root, name } = state.currentScanPos
		const loc = rootLabel(root)
		$('scanPos').textContent = `${loc}\\${name}`
	}
	// 按钮文字：扫描 / 重新扫描
	$('btnScan').textContent = state.hasScanned
		? t('dirs.rescan')
		: t('dirs.scan')
	// 重新渲染列表以更新徽章/路径文案
	renderDrives()
	renderDirs()
	renderJunctions()
	updateTaskList()
}

// ---------- 启动 ----------
// 应用 i18n（从 localStorage 读取的语言），渲染静态文本
applyI18n()
// 按钮初始文字（扫描 / 重新扫描）随语言而定
$('btnScan').textContent = state.hasScanned ? t('dirs.rescan') : t('dirs.scan')
// 只刷新磁盘总览（快），目录扫描等待用户在"目录分析"页点击"扫描"
refreshDrives()
$('btnStopScan').disabled = true
log(t('log.ready'), 'info')
