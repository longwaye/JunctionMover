// JunctionMover 国际化模块 (i18n)
// 默认英文，支持简体中文。语言偏好持久化在 localStorage 的 jm-lang 键。

const STORAGE_KEY = 'jm-lang'
const DEFAULT_LANG = 'en'
const SUPPORTED_LANGS = ['en', 'zh']

let currentLang = DEFAULT_LANG

export const translations = {
	en: {
		// ---------- App ----------
		'app.title': 'JunctionMover - Disk Migration Tool',
		'app.lang_toggle_label_to_zh': 'Switch to Chinese',
		'app.lang_toggle_label_to_en': 'Switch to English',

		// ---------- Navigation ----------
		'nav.drives': 'Disk Overview',
		'nav.dirs': 'Directory Analysis',
		'nav.tasks': 'Migration Tasks',
		'nav.junctions': 'Migrated / Rollback',
		'nav.logs': 'Activity Log',
		'nav.tagline': 'Scan · Analyze · Migrate Safely',

		// ---------- Status ----------
		'status.ready': 'Ready',
		'status.scanning': 'Scanning...',
		'status.scan_done': 'Scanned {n} items · {size} reclaimable',
		'status.scan_stopped': 'Scan stopped',
		'status.scan_failed': 'Scan failed',
		'status.disk_scan_failed': 'Disk scan failed',
		'status.disk_scan_done': 'Disk scan complete',
		'status.migrating': 'Migrating {i}/{n} · {name}',
		'status.migrating_short': 'Migrating {i}/{n}',
		'status.migrate_done': 'Migration complete {ok}/{n}',
		'status.migrate_failed': 'Migration failed',
		'status.rolling_back': 'Rolling back · {name}',
		'status.rollback_done': 'Rollback complete',
		'status.rollback_failed': 'Rollback failed',

		// ---------- Drives panel ----------
		'drives.title': 'Disk Overview',
		'drives.subtitle': 'Drive capacity and free space',
		'drives.scanning': 'Scanning...',
		'drives.card_total': 'Total',
		'drives.card_free': 'Free',
		'drives.card_used': 'Used',

		// ---------- Dirs panel ----------
		'dirs.title': 'AppData Directory Analysis',
		'dirs.subtitle': 'Identify movable app data directories on C drive',
		'dirs.scan': 'Scan',
		'dirs.rescan': 'Rescan',
		'dirs.scanning_prefix': 'Scanning: ',
		'dirs.preparing': 'Preparing...',
		'dirs.stopping': 'Stopping...',
		'dirs.stop_scan': 'Stop Scan',
		'dirs.movable_only': 'Movable only',
		'dirs.big_only': '> 200MB only',
		'dirs.safe_cache': 'Safe picks (large caches)',
		'dirs.safe_cache_title':
			'Show large cache-type directories only (Cache/Temp/Logs). Caches can be rebuilt by apps, making migration relatively safe, but close the corresponding app before migrating.',
		'dirs.add_tasks': 'Add checked to migration →',
		'dirs.col_app': 'App/Directory',
		'dirs.col_location': 'Location',
		'dirs.col_size': 'Size',
		'dirs.col_type': 'Type',
		'dirs.col_status': 'Status',
		'dirs.size_sort_title': 'Click to sort by size',
		'dirs.empty': 'No matching directories. Adjust filters or re-scan.',
		'dirs.location_local': 'AppData/Local',
		'dirs.location_roaming': 'AppData/Roaming',
		'dirs.location_home': 'Home (dot-folders)',
		'dirs.scan_failed_row': 'Scan failed: {msg}',
		'dirs.check_title_junction':
			"Migrated directories: manage in 'Migrated / Rollback' tab",
		'dirs.stat_safe':
			'Safe picks: {n} large cache directories (sorted by size). Close the corresponding app before migrating.',
		'dirs.stat_normal': '{total} directories total, {n} match',

		// ---------- Tasks panel ----------
		'tasks.title': 'Migration Tasks',
		'tasks.subtitle':
			'Select target → Copy → Verify → Delete source → Create Junction → Validate. Fully reversible.',
		'tasks.batch_target': 'Batch set target folder...',
		'tasks.start_migrate': 'Start migration',
		'tasks.empty':
			'No tasks yet. Check directories in "Directory Analysis" and click "Add to migration".',
		'tasks.in_progress': 'Migrating...',
		'tasks.rolling_back': 'Rolling back...',
		'tasks.no_target': 'No target folder set',
		'tasks.set_folder': 'Choose folder...',
		'tasks.change': 'Change...',
		'tasks.remove': 'Remove',
		'tasks.remove_title': 'Remove from task list (re-check to add again)',
		'tasks.route_src': 'Source: {path}',
		'tasks.route_dst': 'Migrate to: {path}',
		'tasks.hint_movable': '{n} movable',
		'tasks.hint_no_target': '{n} without target',
		'tasks.hint_join': ' · ',
		'tasks.prog_text':
			'{pct}% · {done}/{total} files · {bytesDone}/{bytesTotal}',
		'tasks.no_movable':
			'No movable tasks: check tasks and set target folders first',
		'tasks.skipped_no_target': 'Skipped {name}: no target folder',
		'tasks.batch_set_log': 'Set target folder for {n} tasks: {folder}',
		'tasks.target_set_log': 'Target folder set: {name} -> {folder}',
		'tasks.removed_log':
			'Removed from migration: {name} (re-check to add again)',
		'tasks.pick_folder_err_log': 'Failed to open folder picker: {err}',
		'tasks.migrating_badge': 'Migrating...',
		'tasks.migrated_ok_badge': '✓ Migrated',
		'tasks.failed_badge': 'Failed: {msg}',
		'tasks.error_badge': 'Error',
		'tasks.rollback_ing_badge': 'Rolling back...',
		'tasks.rolled_back_badge': '✓ Rolled back to C',
		'tasks.error_rollback_badge': 'Error: {msg}',
		'tasks.migrate_progress_label': 'Migrating {i}/{n}: {name}',
		'tasks.rollback_label': 'Rolling back: {name}',
		'tasks.migrate_start_log': 'Start migration {name}: {src} -> {dst}',
		'tasks.migrate_result_log': '{icon} {name}: {msg}',
		'tasks.migrate_exception_log': '{name} migration exception: {err}',
		'tasks.migrate_done_summary': 'Migration done ({ok}/{n} succeeded)',
		'tasks.migrate_all_failed': 'All migrations failed, scan results unchanged',
		'tasks.migrate_updated_log':
			"Updated {n} directory statuses locally (no rescan); click 'Rescan' to detect external changes",
		'tasks.rollback_start_log': 'Start rollback {name}: {path}',
		'tasks.rollback_result_log': '{icon} Rollback {name}: {msg}',
		'tasks.rollback_exception_log': '{name} rollback exception: {err}',
		'tasks.rollback_done_text': 'Rollback done',
		'tasks.rollback_failed_text': 'Rollback failed, can retry',

		// ---------- Junctions panel ----------
		'junc.title': 'Migrated / Rollback',
		'junc.subtitle':
			'All directories migrated to other drives via Junction. Can be safely rolled back to C drive.',
		'junc.view_tree': 'By tree',
		'junc.view_size': 'By size',
		'junc.sort_desc': 'Large → Small',
		'junc.sort_asc': 'Small → Large',
		'junc.empty':
			'No migrated directories found. Re-scan after migration to roll back here.',
		'junc.rollback': 'Roll back to C',
		'junc.rollback_ing': 'Rolling back...',
		'junc.migrated_badge': 'Migrated',
		'junc.c_junction': 'C junction',
		'junc.c_occupy': 'C usage 0 B',
		'junc.c_junction_detail': 'C junction (C usage 0 B): {path}',
		'junc.c_junction_size': 'C junction · 0 B: {path}',
		'junc.data_location': 'Data location',
		'junc.data_location_detail': 'Data location: {path}',
		'junc.unknown': '(unknown)',
		'junc.stat': '{n} migrated directories',
		'junc.tree_agg': '{size} · {n} items',
		'junc.migrated_junction_badge': 'Migrated (Junction)',

		// ---------- Logs panel ----------
		'logs.title': 'Activity Log',
		'logs.subtitle': 'Detailed log of all operations',
		'logs.clear': 'Clear log',

		// ---------- Type badges ----------
		'type.cache': 'Cache',
		'type.system': 'System',
		'type.config': 'Config',
		'type.data': 'Data',
		'type.app_data': 'App Data',
		'type.system_caution': 'System/Caution',
		'type.unknown': 'Unknown',

		// ---------- State badges (dir status) ----------
		'state.migrated': 'Migrated',
		'state.not_recommended': 'Not recommended',
		'state.movable': 'Movable',

		// ---------- Log messages ----------
		'log.scan_start': 'Scanning AppData directories...',
		'log.scan_done': 'Scan complete: found {n} directories',
		'log.scan_stopped': 'Scan stopped',
		'log.scan_stopped_kept':
			'Scan stopped: kept {n} directories scanned so far',
		'log.added_tasks': 'Added {n} migration tasks',
		'log.migrate_start': 'Migrating {n} directories...',
		'log.migrate_ok': 'Migrated: {name}',
		'log.migrate_fail': 'Migration failed: {name} - {msg}',
		'log.rollback_ok': 'Rolled back: {name}',
		'log.rollback_fail': 'Rollback failed: {name} - {msg}',
		'log.open_folder_err': 'Failed to open folder',
		'log.open_folder_err_detail': 'Failed to open folder: {err}',
		'log.scan_disk_fail': 'Disk scan failed: {err}',
		'log.scan_dirs_fail': 'Directory scan failed: {err}',
		'log.stop_scan_fail': 'Stop scan failed: {err}',
		'log.listen_progress_fail': 'Failed to listen for progress events: {err}',
		'log.listen_dir_item_fail': 'Failed to listen for directory events: {err}',
		'log.listen_migrate_fail': 'Failed to listen for migration progress: {err}',
		'log.listen_rollback_fail': 'Failed to listen for rollback progress: {err}',
		'log.ready':
			"JunctionMover ready. Go to 'Directory Analysis' and click 'Scan' to start.",

		// ---------- Copy stages ----------
		'copy.stage_copy_data': 'Copying data',
		'copy.stage_copy_back': 'Copying back to C drive',
		'copy.stage_default': 'Copying',
		'copy.overall_progress':
			'{i}/{n} · {pct}% · {filesDone}/{filesTotal} files · {bytesDone}/{bytesTotal}',
		'copy.progress_detail': '{done}/{total} files · {bytesDone}/{bytesTotal}',

		// ---------- Backend PROGRESS stage keys ----------
		'stage.check_space': 'Checking disk space',
		'stage.no_procs': 'No processes in use',
		'stage.procs_found': 'Processes in use detected',
		'stage.procs_closed': 'Processes closed',
		'stage.copying': 'Copying data',
		'stage.verifying': 'Verifying copy',
		'stage.deleting_src': 'Deleting C: source',
		'stage.creating_junction': 'Creating junction',
		'stage.copying_back': 'Copying back to C:',
		'stage.verifying_staging': 'Verifying staging',
		'stage.removing_junction': 'Removing junction',
		'stage.restoring_dir': 'Restoring C: directory',
		'stage.done': 'Done',

		// ---------- Drive scan ----------
		'drive.scan_disk_fail_log': 'Disk scan failed: {err}',
	},

	zh: {
		// ---------- App ----------
		'app.title': 'JunctionMover - 磁盘迁移工具',
		'app.lang_toggle_label_to_zh': '切换到中文',
		'app.lang_toggle_label_to_en': 'Switch to English',

		// ---------- Navigation ----------
		'nav.drives': '磁盘总览',
		'nav.dirs': '目录分析',
		'nav.tasks': '迁移任务',
		'nav.junctions': '已迁移 / 回滚',
		'nav.logs': '操作日志',
		'nav.tagline': '扫描 · 分析 · 安全迁移',

		// ---------- Status ----------
		'status.ready': '就绪',
		'status.scanning': '扫描中...',
		'status.scan_done': '已扫描 {n} 项 · 可释放 {size}',
		'status.scan_stopped': '已停止扫描',
		'status.scan_failed': '扫描失败',
		'status.disk_scan_failed': '磁盘扫描失败',
		'status.disk_scan_done': '磁盘扫描完成',
		'status.migrating': '迁移中 {i}/{n} · {name}',
		'status.migrating_short': '迁移中 {i}/{n}',
		'status.migrate_done': '迁移完成 {ok}/{n}',
		'status.migrate_failed': '迁移失败',
		'status.rolling_back': '回滚中 · {name}',
		'status.rollback_done': '回滚完成',
		'status.rollback_failed': '回滚失败',

		// ---------- Drives panel ----------
		'drives.title': '磁盘总览',
		'drives.subtitle': '各盘容量与剩余空间',
		'drives.scanning': '扫描中...',
		'drives.card_total': '总量',
		'drives.card_free': '剩余',
		'drives.card_used': '已用',

		// ---------- Dirs panel ----------
		'dirs.title': 'AppData 目录分析',
		'dirs.subtitle': '识别 C 盘可迁移的应用数据目录',
		'dirs.scan': '扫描',
		'dirs.rescan': '重新扫描',
		'dirs.scanning_prefix': '正在扫描：',
		'dirs.preparing': '准备中...',
		'dirs.stopping': '正在停止...',
		'dirs.stop_scan': '停止扫描',
		'dirs.movable_only': '只看可迁移',
		'dirs.big_only': '只看 > 200MB',
		'dirs.safe_cache': '安全推荐（大缓存）',
		'dirs.safe_cache_title':
			'只显示大型缓存类目录（Cache/Temp/Logs 等）。缓存可由软件自动重建，迁移风险相对最低，但迁移前仍请关闭对应软件',
		'dirs.add_tasks': '添加勾选到迁移任务 →',
		'dirs.col_app': '应用/目录',
		'dirs.col_location': '位置',
		'dirs.col_size': '大小',
		'dirs.col_type': '类型',
		'dirs.col_status': '状态',
		'dirs.size_sort_title': '点击按大小排序',
		'dirs.empty': '没有符合条件的目录，调整筛选或点击重新扫描。',
		'dirs.location_local': 'AppData/Local',
		'dirs.location_roaming': 'AppData/Roaming',
		'dirs.location_home': '用户主目录（点文件夹）',
		'dirs.scan_failed_row': '扫描失败：{msg}',
		'dirs.check_title_junction': '已迁移目录请到「已迁移 / 回滚」页面操作',
		'dirs.stat_safe':
			'安全推荐：{n} 个大型缓存目录（按大小排序），迁移前请关闭对应软件',
		'dirs.stat_normal': '共 {total} 个目录，符合条件 {n} 个',

		// ---------- Tasks panel ----------
		'tasks.title': '迁移任务',
		'tasks.subtitle':
			'选目标文件夹 → 复制 → 校验 → 删源 → 建 Junction → 验证，全程可回滚',
		'tasks.batch_target': '批量设置目标文件夹...',
		'tasks.start_migrate': '开始迁移勾选项',
		'tasks.empty':
			'尚未添加任务。在"目录分析"中勾选目录后，点击"添加勾选到迁移任务"。',
		'tasks.in_progress': '迁移中...',
		'tasks.rolling_back': '回滚中...',
		'tasks.no_target': '未设置目标文件夹',
		'tasks.set_folder': '选择文件夹...',
		'tasks.change': '更改...',
		'tasks.remove': '删除',
		'tasks.remove_title': '从任务列表移除（需重新勾选添加）',
		'tasks.route_src': '源：{path}',
		'tasks.route_dst': '迁移到：{path}',
		'tasks.hint_movable': '可迁移 {n} 项',
		'tasks.hint_no_target': '{n} 项未设目标',
		'tasks.hint_join': ' · ',
		'tasks.prog_text':
			'{pct}% · {done}/{total} 个文件 · {bytesDone}/{bytesTotal}',
		'tasks.no_movable': '没有可迁移的任务：请先勾选任务并为其设置目标文件夹',
		'tasks.skipped_no_target': '跳过 {name}：未设置目标文件夹',
		'tasks.batch_set_log': '已为 {n} 个任务统一设置目标文件夹: {folder}',
		'tasks.target_set_log': '目标文件夹已设置: {name} -> {folder}',
		'tasks.removed_log': '已从迁移任务移除: {name}（需重新勾选添加）',
		'tasks.pick_folder_err_log': '打开文件夹选择窗口失败: {err}',
		'tasks.migrating_badge': '迁移中...',
		'tasks.migrated_ok_badge': '✓ 已迁移',
		'tasks.failed_badge': '失败：{msg}',
		'tasks.error_badge': '错误',
		'tasks.rollback_ing_badge': '回滚中...',
		'tasks.rolled_back_badge': '✓ 已迁回 C 盘',
		'tasks.error_rollback_badge': '错误：{msg}',
		'tasks.migrate_progress_label': '正在迁移 {i}/{n}: {name}',
		'tasks.rollback_label': '正在回滚: {name}',
		'tasks.migrate_start_log': '开始迁移 {name}: {src} -> {dst}',
		'tasks.migrate_result_log': '{icon} {name}: {msg}',
		'tasks.migrate_exception_log': '{name} 迁移异常: {err}',
		'tasks.migrate_done_summary': '迁移结束（成功 {ok}/{n}）',
		'tasks.migrate_all_failed': '迁移全部失败，未改动扫描结果',
		'tasks.migrate_updated_log':
			'已本地更新 {n} 个目录的状态（未重新扫描）；如需发现应用外的改动请手动点「重新扫描」',
		'tasks.rollback_start_log': '开始回滚 {name}: {path}',
		'tasks.rollback_result_log': '{icon} 回滚 {name}: {msg}',
		'tasks.rollback_exception_log': '{name} 回滚异常: {err}',
		'tasks.rollback_done_text': '回滚结束',
		'tasks.rollback_failed_text': '回滚失败，可重试',

		// ---------- Junctions panel ----------
		'junc.title': '已迁移 / 回滚',
		'junc.subtitle': '所有通过 Junction 迁移到其他盘的目录，可安全迁回 C 盘',
		'junc.view_tree': '按层级',
		'junc.view_size': '按大小',
		'junc.sort_desc': '大 → 小',
		'junc.sort_asc': '小 → 大',
		'junc.empty': '没有发现已迁移的目录。完成迁移后重新扫描即可在此回滚。',
		'junc.rollback': '迁回 C 盘',
		'junc.rollback_ing': '回滚中...',
		'junc.migrated_badge': '已迁移',
		'junc.c_junction': 'C 盘联接',
		'junc.c_occupy': 'C盘占用 0 B',
		'junc.c_junction_detail': 'C 盘联接（C盘占用 0 B）：{path}',
		'junc.c_junction_size': 'C 盘联接 · 占用 0 B：{path}',
		'junc.data_location': '数据位置',
		'junc.data_location_detail': '数据位置：{path}',
		'junc.unknown': '（未知）',
		'junc.stat': '共 {n} 个已迁移目录',
		'junc.tree_agg': '{size} · {n} 项',
		'junc.migrated_junction_badge': '已迁移(Junction)',

		// ---------- Logs panel ----------
		'logs.title': '操作日志',
		'logs.subtitle': '所有操作的详细记录',
		'logs.clear': '清空日志',

		// ---------- Type badges ----------
		'type.cache': '缓存',
		'type.system': '系统',
		'type.config': '配置',
		'type.data': '数据',
		'type.app_data': '应用数据',
		'type.system_caution': '系统/谨慎',
		'type.unknown': '未知',

		// ---------- State badges (dir status) ----------
		'state.migrated': '已迁移',
		'state.not_recommended': '不建议',
		'state.movable': '可迁移',

		// ---------- Log messages ----------
		'log.scan_start': '开始扫描 AppData 目录...',
		'log.scan_done': '扫描完成：发现 {n} 个目录',
		'log.scan_stopped': '扫描已停止',
		'log.scan_stopped_kept': '扫描已停止：保留已扫描的 {n} 个目录',
		'log.added_tasks': '已添加 {n} 个迁移任务',
		'log.migrate_start': '开始迁移 {n} 个目录',
		'log.migrate_ok': '迁移成功：{name}',
		'log.migrate_fail': '迁移失败：{name} - {msg}',
		'log.rollback_ok': '回滚成功：{name}',
		'log.rollback_fail': '回滚失败：{name} - {msg}',
		'log.open_folder_err': '打开文件夹失败',
		'log.open_folder_err_detail': '打开文件夹失败: {err}',
		'log.scan_disk_fail': '扫描磁盘失败: {err}',
		'log.scan_dirs_fail': '扫描目录失败: {err}',
		'log.stop_scan_fail': '停止扫描失败: {err}',
		'log.listen_progress_fail': '监听进度事件失败: {err}',
		'log.listen_dir_item_fail': '监听目录事件失败: {err}',
		'log.listen_migrate_fail': '监听迁移进度失败: {err}',
		'log.listen_rollback_fail': '监听回滚进度失败: {err}',
		'log.ready': 'JunctionMover 已就绪。进入「目录分析」点击「扫描」开始。',

		// ---------- Copy stages ----------
		'copy.stage_copy_data': '复制数据中',
		'copy.stage_copy_back': '复制回 C 盘中',
		'copy.stage_default': '复制中',
		'copy.overall_progress':
			'{i}/{n} · {pct}% · {filesDone}/{filesTotal} 文件 · {bytesDone}/{bytesTotal}',
		'copy.progress_detail': '{done}/{total} 文件 · {bytesDone}/{bytesTotal}',

		// ---------- Backend PROGRESS stage keys ----------
		'stage.check_space': '检查磁盘空间',
		'stage.no_procs': '无占用进程',
		'stage.procs_found': '检测到占用进程',
		'stage.procs_closed': '占用进程已关闭',
		'stage.copying': '复制数据中',
		'stage.verifying': '校验复制结果',
		'stage.deleting_src': '删除 C 盘原目录',
		'stage.creating_junction': '建立目录联接',
		'stage.copying_back': '复制数据回 C 盘',
		'stage.verifying_staging': '校验暂存数据',
		'stage.removing_junction': '移除目录联接',
		'stage.restoring_dir': '恢复 C 盘原目录',
		'stage.done': '完成',

		// ---------- Drive scan ----------
		'drive.scan_disk_fail_log': '扫描磁盘失败: {err}',
	},
}

function loadStoredLang() {
	try {
		const v = localStorage.getItem(STORAGE_KEY)
		if (v && SUPPORTED_LANGS.includes(v)) return v
	} catch (_) {
		// localStorage 不可用时回退默认语言
	}
	return DEFAULT_LANG
}

export function getCurrentLang() {
	return currentLang
}

export function isSupportedLang(lang) {
	return SUPPORTED_LANGS.includes(lang)
}

// 翻译字符串：未找到 key 时回退到默认语言，仍找不到则原样返回 key。
// 支持模板参数：t('status.migrating', { i: 3, n: 5, name: 'JetBrains' })
// 字符串中的 {i}/{n}/{name} 占位符会被对应参数替换。
export function t(key, params) {
	const dict = translations[currentLang] || translations[DEFAULT_LANG]
	let s = dict ? dict[key] : undefined
	if (s == null && currentLang !== DEFAULT_LANG) {
		s = translations[DEFAULT_LANG] ? translations[DEFAULT_LANG][key] : undefined
	}
	if (s == null) return key
	if (params) {
		s = String(s).replace(/\{(\w+)\}/g, (_, k) =>
			params[k] != null ? String(params[k]) : `{${k}}`,
		)
	}
	return s
}

// 设置当前语言并持久化，随后重新应用所有 [data-i18n] 元素。
export function setLang(lang) {
	if (!SUPPORTED_LANGS.includes(lang)) return
	currentLang = lang
	try {
		localStorage.setItem(STORAGE_KEY, lang)
	} catch (_) {
		// 忽略写入失败（隐私模式等）
	}
	if (typeof document !== 'undefined') {
		document.documentElement.lang = lang
	}
	applyI18n()
}

// 在 en / zh 之间切换
export function toggleLang() {
	setLang(currentLang === 'en' ? 'zh' : 'en')
}

// 遍历所有带 [data-i18n] 的元素，设置其 textContent；
// 若元素同时带 [data-i18n-html]，则改用 innerHTML。
// 额外支持 [data-i18n-title] / [data-i18n-placeholder] / [data-i18n-aria-label]
// 用于翻译 title / placeholder / aria-label 属性。
export function applyI18n() {
	if (typeof document === 'undefined') return
	document.querySelectorAll('[data-i18n]').forEach((el) => {
		const key = el.getAttribute('data-i18n')
		if (!key) return
		if (el.hasAttribute('data-i18n-html')) {
			el.innerHTML = t(key)
		} else {
			el.textContent = t(key)
		}
	})
	document.querySelectorAll('[data-i18n-title]').forEach((el) => {
		const key = el.getAttribute('data-i18n-title')
		if (key) el.setAttribute('title', t(key))
	})
	document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
		const key = el.getAttribute('data-i18n-placeholder')
		if (key) el.setAttribute('placeholder', t(key))
	})
	document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
		const key = el.getAttribute('data-i18n-aria-label')
		if (key) el.setAttribute('aria-label', t(key))
	})
	updateLangToggleBtn()
}

// 更新顶栏语言切换按钮显示：英文模式显示「中文」，中文模式显示「EN」
function updateLangToggleBtn() {
	const btn = document.getElementById('langToggle')
	if (!btn) return
	btn.textContent = currentLang === 'en' ? '中文' : 'EN'
	btn.setAttribute(
		'aria-label',
		currentLang === 'en'
			? t('app.lang_toggle_label_to_zh')
			: t('app.lang_toggle_label_to_en'),
	)
}

// 模块加载时从 localStorage 读取偏好，确保 t() 在 main.js 调用前已可用。
// main.js 启动时只需调用 applyI18n() 应用到 DOM。
currentLang = loadStoredLang()
if (typeof document !== 'undefined') {
	document.documentElement.lang = currentLang
}
