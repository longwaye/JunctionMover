# JunctionMover

> 释放 C 盘空间，把其他软件在 AppData 下占用大量空间的目录迁移到其他盘，通过 Windows 目录联接（Junction）让软件无感访问，支持一键回滚。

[English](README.md)

## 截图

|               磁盘总览               |                 目录分析                  |
| :----------------------------------: | :---------------------------------------: |
| ![](screenshots/Disk%20Overview.png) | ![](screenshots/Directory%20Analysis.png) |

|                迁移任务                |                已迁移与回滚                 |
| :------------------------------------: | :-----------------------------------------: |
| ![](screenshots/Migration%20Tasks.png) | ![](screenshots/Migrated%20%20Rollback.png) |

|              活动日志               |
| :---------------------------------: |
| ![](screenshots/Activity%20Log.png) |

## 工作原理

JunctionMover 将占用空间的目录迁移到其他盘，扫描三个位置：

- `C:\Users\<用户名>\AppData\Local`
- `C:\Users\<用户名>\AppData\Roaming`
- 用户主目录下的点开头文件夹（如 `.dsh`、`.gradle`、`.npm`、`.cache`），不会枚举桌面、文档等个人文件夹

迁移流程如下：

1. 扫描上述位置，按目录类型（缓存/数据/配置/系统）分类，标注可迁移性
2. 用 robocopy 将数据复制到目标盘，校验文件数和大小完全一致
3. 删除 C 盘原目录，创建 Windows 目录联接（Junction），原路径指向新位置
4. 软件通过原路径访问时，系统自动跳转到目标盘，对软件完全透明

> **Windows 目录联接（Junction）** 是系统自带的功能，访问原路径时系统自动跳转到新位置。Windows 自身和大量软件都在使用此机制。

## 核心特性

- **目录扫描**：遍历 `AppData\Local`、`AppData\Roaming` 和用户主目录下的点开头文件夹，按类型分类，标注可迁移性
- **安全迁移**：robocopy 复制 → 文件数+字节双校验 → 删源 → 建联接 → 联接验证，任何一步失败都会中止，失败时自动回拷
- **一键回滚**：将数据从目标盘搬回 C 盘原路径，自动移除联接
- **缓存推荐**：缓存类目录（Cache、Temp、Logs）软件可自动重建，迁移风险较低，单独筛选优先推荐
- **深层联接发现**：扫描不只限于顶层目录，深层已迁移的联接（如 Chrome 各 Profile）也能识别
- **Restart Manager 集成**：迁移前自动检测并关闭占用源目录的进程
- **进度可视**：复制进度实时刷新（文件数、字节数、百分比），批量迁移显示总进度
- **中英双语**：界面语言一键切换，默认英文
- **打开目录**：点击任意目录名可直接在资源管理器中打开对应位置
- **纯本地**：不联网、不上传、不收集数据，所有操作在本地完成

## 下载安装

### 方式一：下载发布包

到 [Releases](https://github.com/longwaye/JunctionMover/releases) 页面，提供两种包：

- `JunctionMover_x.x.x_x64-setup.exe` — 安装版（推荐）
- `JunctionMover_x.x.x_portable_x64.zip` — 绿色版，解压即用，不安装、不写注册表

两种包都依赖 WebView2 运行时，Windows 10（1803+）和 Windows 11 默认已预装。

### 方式二：自行编译

需要 [Node.js](https://nodejs.org/)（18+）、[Rust](https://rustup.rs/) 和 [Tauri 2](https://v2.tauri.app/) 环境。

```bash
git clone https://github.com/longwaye/JunctionMover.git
cd JunctionMover
npm install
npm run tauri dev    # 开发预览
npm run tauri build  # 打包安装包
```

## 使用方法

### 基本流程

1. 打开 JunctionMover，左侧「目录分析」点击「扫描」
2. 扫描完成后，列表显示每个目录的大小、类型、可迁移性
3. 勾选需要迁移的目录（可先勾「安全推荐」筛选缓存类目录）
4. 点击「迁移选中项到 →」，选择其他盘的文件夹作为存放位置
5. 等待复制、校验、建联接完成，C 盘空间即释放

### 迁移后管理

- 迁移过的目录出现在「已迁移 / 回滚」页
- 按**层级树**查看数据实际存放路径
- 按**大小**排序，快速定位占空间最大的目录
- 点击「迁回 C 盘」将数据原路搬回

### 注意事项

- 迁移前需关闭对应软件（如迁移 Chrome 缓存前先关闭 Chrome），文件占用会导致删除失败
- 缓存目录迁移风险较低，但缓存中可能包含正在使用的会话文件
- 回滚会将数据从目标盘搬回 C 盘，若手动删除了目标盘数据则无法回滚
- 系统目录（Microsoft、Windows、NVIDIA 等）不支持迁移
- 主目录点文件夹中包含 `.ssh`、`.aws`、`.gnupg` 等凭证目录，它们会显示在列表中，但不建议迁移，除非清楚后果

## 技术栈

| 层       | 技术                             | 说明                                    |
| -------- | -------------------------------- | --------------------------------------- |
| 桌面框架 | [Tauri 2](https://v2.tauri.app/) | Rust 后端 + WebView 前端，安装包约 5MB  |
| 后端     | Rust                             | 路径校验、PowerShell 调度、进度流式推送 |
| 原生操作 | PowerShell 5.1 + robocopy        | Windows 原生能力                        |
| 前端     | 原生 HTML/CSS/JS                 | 无框架依赖                              |

## 安全设计

- **路径校验**：源和目标必须是绝对路径、必须跨盘、不能是自身或子目录
- **防注入**：所有用户路径经单引号双写转义后注入 PowerShell，不经字符串拼接
- **权限最小化**：Tauri 只开启核心 API + 文件夹选择对话框，无额外 shell/fs/http 权限
- **CSP 策略**：禁止 `unsafe-eval`，连接限制在本地
- **同盘联接拦截**：Windows 自带的兼容联接（Application Data 等）不会被误操作

## 项目结构

```
JunctionMover/
├── src/                    # 前端
│   ├── index.html          # 页面结构
│   ├── main.js            # 交互逻辑
│   ├── i18n.js            # 国际化
│   └── styles.css         # 样式
├── src-tauri/             # Rust 后端
│   ├── src/
│   │   ├── commands/      # Tauri 命令
│   │   │   ├── migrate.rs  # 迁移逻辑
│   │   │   ├── rollback.rs # 回滚逻辑
│   │   │   ├── scan.rs     # 扫描逻辑
│   │   │   └── shell.rs    # 打开资源管理器
│   │   ├── ps.rs           # PowerShell 执行层
│   │   ├── pathutil.rs     # 路径校验
│   │   ├── model.rs        # 类型定义
│   │   └── state.rs        # 应用状态
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
├── screenshots/            # README 使用的截图
├── package.json
├── vite.config.js
├── .gitignore
├── LICENSE                 # MIT 协议
├── README.md               # 英文文档
└── README.zh-CN.md         # 中文文档
```

## 仓库文件说明

仓库只追踪源代码和文档，开发过程中生成的内容由 [.gitignore](.gitignore) 排除：

| 规则                                    | 排除内容                               |
| --------------------------------------- | -------------------------------------- |
| `node_modules/`、`dist/`                | 前端依赖和 Vite 构建产物               |
| `src-tauri/target/`、`src-tauri/gen/`   | Rust 构建缓存和 Tauri 生成文件         |
| `.vscode/`、`.idea/`                    | 编辑器配置                             |
| `*.log`                                 | 日志文件                               |
| `*.ps1`、`*.bat`                        | 本地临时脚本                           |
| `/*.zip`、`/*-setup.exe`                | 发布安装包（统一发布在 Releases 页面） |
| `Thumbs.db`、`Desktop.ini`、`.DS_Store` | 系统生成文件                           |

克隆仓库后执行 `npm install` 和 `npm run tauri build` 即可重新生成所有被排除的内容。

## 开发

```bash
# 安装前端依赖
npm install

# 开发模式（热重载）
npm run tauri dev

# 打包
npm run tauri build
npm run package      # 复制出带版本号的 exe（JunctionMover_x.x.x_x64.exe）

# 运行测试（常规单元测试）
cd src-tauri && cargo test

# 端到端测试（需 E: 盘，手工执行）
cd src-tauri && cargo test e2e_migrate_scenarios -- --ignored --nocapture
```

## 常见问题

**迁移后软件还能正常用吗**

能。Junction 对软件完全透明，软件访问原路径时系统自动跳转到新位置。Chrome、JetBrains、各种游戏等均正常。

**迁移出问题时数据会丢吗**

不会。迁移流程是：先复制 → 校验一致 → 才删原目录 → 才建联接。任何一步失败都会中止，数据始终至少有一份完整副本。联接创建失败的极端场景也会自动回拷。

**能迁移哪些目录**

`AppData\Local`、`AppData\Roaming` 下的用户数据目录，以及用户主目录下的点开头文件夹（`.dsh`、`.gradle`、`.npm` 等）。系统目录（Microsoft、Windows、NVIDIA 等）已自动排除。缓存类目录（Cache、Temp、Logs）迁移风险最低，有「安全推荐」筛选。`.ssh`、`.aws` 等凭证文件夹虽然可见，但不建议迁移。

**支持 Windows 7 / 8 吗**

需要 Windows 10 及以上。Junction 本身从 XP 就支持，但 PowerShell 5.1 和部分 API 依赖新版系统。

## License

MIT
