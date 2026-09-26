# JunctionMover

> Free up C: drive space by moving large AppData directories from other apps to other drives using Windows Junctions. Apps keep working without any configuration changes. One-click rollback supported.

[中文文档](README.zh-CN.md)

## Screenshots

|            Disk Overview             |            Directory Analysis             |
| :----------------------------------: | :---------------------------------------: |
| ![](screenshots/Disk%20Overview.png) | ![](screenshots/Directory%20Analysis.png) |

|            Migration Tasks             |             Migrated & Rollback             |
| :------------------------------------: | :-----------------------------------------: |
| ![](screenshots/Migration%20Tasks.png) | ![](screenshots/Migrated%20%20Rollback.png) |

|            Activity Log             |
| :---------------------------------: |
| ![](screenshots/Activity%20Log.png) |

## How It Works

JunctionMover moves space-consuming directories to another drive. It scans three locations:

- `C:\Users\<you>\AppData\Local`
- `C:\Users\<you>\AppData\Roaming`
- Dot-folders directly under the user home directory (e.g. `.dsh`, `.gradle`, `.npm`, `.cache`) — standard user folders like Desktop and Documents are never enumerated

Migration flow:

1. Scans the locations above, classifies directories by type (cache/data/config/system), marks movability
2. Copies data to the target drive using robocopy, verifies file count and total bytes match
3. Deletes the original C drive directory, creates a Windows Junction so the original path points to the new location
4. When apps access the original path, the OS transparently redirects to the target drive

> **Windows Directory Junction** is a built-in NTFS feature. When you access the original path, the OS automatically redirects to the new location. Windows itself and many applications use this mechanism.

## Key Features

- **Directory Scanning**: Traverses `AppData\Local`, `AppData\Roaming`, and dot-folders in the user home directory, classifies by type, marks movability
- **Safe Migration**: robocopy copy → file count + byte dual verification → delete source → create junction → verify junction. Any step failure aborts the operation; failed junction creation triggers automatic data restoration
- **One-Click Rollback**: Moves data back from the target drive to the original C drive path, removes the junction
- **Cache Recommendations**: Cache directories (Cache, Temp, Logs) can be rebuilt by apps, making them relatively safe to migrate. Filtered and prioritized separately
- **Deep Junction Discovery**: Scans beyond top-level directories — deeply nested migrated junctions (e.g., Chrome Profile directories) are also detected
- **Restart Manager Integration**: Automatically detects and closes processes locking the source directory before migration
- **Live Progress**: Real-time copy progress (file count, bytes, percentage), batch migration shows overall progress
- **Bilingual UI**: English / Chinese toggle, defaults to English
- **Open in Explorer**: Click any directory name to open its location in File Explorer
- **Fully Local**: No network, no uploads, no data collection. All operations run locally

## Download & Install

### Option 1: Download a release build

Go to the [Releases](https://github.com/longwaye/JunctionMover/releases) page. Two packages are provided:

- `JunctionMover_x.x.x_x64-setup.exe` — installer (recommended)
- `JunctionMover_x.x.x_portable_x64.zip` — portable build, unzip and run, no installation and no registry changes

Both require the WebView2 runtime, which is preinstalled on Windows 10 (1803+) and Windows 11.

### Option 2: Build from source

Requires [Node.js](https://nodejs.org/) (18+), [Rust](https://rustup.rs/), and [Tauri 2](https://v2.tauri.app/).

```bash
git clone https://github.com/longwaye/JunctionMover.git
cd JunctionMover
npm install
npm run tauri dev    # dev preview
npm run tauri build  # build installer
```

## Usage

### Basic Flow

1. Open JunctionMover, go to "Directory Analysis" and click "Scan"
2. After scanning, the list shows each directory's size, type, and movability
3. Check the directories to migrate (enable "Safe picks" to filter for cache directories)
4. Click "Add to migration →", select a folder on another drive as the storage location
5. Wait for copy, verification, and junction creation to complete. C drive space is freed.

### Post-Migration Management

- Migrated directories appear in the "Migrated / Rollback" panel
- View data storage paths in a **tree hierarchy**
- Sort by **size** to quickly find the largest directories
- Click "Roll back to C" to move data back to the original path

### Notes

- Close the corresponding app before migrating (e.g., close Chrome before migrating Chrome cache). File locks will cause deletion to fail.
- Cache directories are relatively safe to migrate, but caches may contain active session files.
- Rollback moves data from the target drive back to C drive. If you manually deleted the target drive data, rollback is not possible.
- System directories (Microsoft, Windows, NVIDIA, etc.) are not supported for migration.
- Home dot-folders include credential directories such as `.ssh`, `.aws`, and `.gnupg`. They are listed for completeness but should not be migrated unless you know what you are doing.

## Tech Stack

| Layer             | Technology                       | Notes                                                         |
| ----------------- | -------------------------------- | ------------------------------------------------------------- |
| Desktop framework | [Tauri 2](https://v2.tauri.app/) | Rust backend + WebView frontend, ~5MB installer               |
| Backend           | Rust                             | Path validation, PowerShell orchestration, progress streaming |
| Native operations | PowerShell 5.1 + robocopy        | Windows native capabilities                                   |
| Frontend          | Vanilla HTML/CSS/JS              | No framework dependencies                                     |

## Security Design

- **Path Validation**: Source and target must be absolute paths, on different drives, not self or subdirectory
- **Injection Prevention**: All user paths are single-quote-escaped before PowerShell injection, no string concatenation
- **Minimal Permissions**: Tauri only enables core API + folder picker dialog, no extra shell/fs/http permissions
- **CSP Policy**: `unsafe-eval` disabled, connections restricted to local
- **Same-Drive Junction Blocking**: Windows compatibility junctions (Application Data, etc.) are protected from accidental operation

## Project Structure

```
JunctionMover/
├── src/                    # Frontend
│   ├── index.html          # Page structure
│   ├── main.js            # Application logic
│   ├── i18n.js            # Internationalization
│   └── styles.css         # Styles
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── commands/      # Tauri commands
│   │   │   ├── migrate.rs  # Migration logic
│   │   │   ├── rollback.rs # Rollback logic
│   │   │   ├── scan.rs     # Scan logic
│   │   │   └── shell.rs    # Open folder in Explorer
│   │   ├── ps.rs           # PowerShell execution layer
│   │   ├── pathutil.rs     # Path validation
│   │   ├── model.rs        # Type definitions
│   │   └── state.rs        # App state
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri config
├── screenshots/            # Screenshots used in README
├── package.json
├── vite.config.js
├── .gitignore
├── LICENSE                 # MIT
├── README.md               # English documentation
└── README.zh-CN.md         # Chinese documentation
```

## Repository Files

Only source code and documentation are tracked in git. The [.gitignore](.gitignore) excludes everything generated during development:

| Rule                                    | Excludes                                                  |
| --------------------------------------- | --------------------------------------------------------- |
| `node_modules/`, `dist/`                | Frontend dependencies and Vite build output               |
| `src-tauri/target/`, `src-tauri/gen/`   | Rust build cache and Tauri-generated files                |
| `.vscode/`, `.idea/`                    | Editor settings                                           |
| `*.log`                                 | Log files                                                 |
| `*.ps1`, `*.bat`                        | Local temporary scripts                                   |
| `/*.zip`, `/*-setup.exe`                | Release packages (published on the Releases page instead) |
| `Thumbs.db`, `Desktop.ini`, `.DS_Store` | OS-generated files                                        |

Cloning the repository and running `npm install` followed by `npm run tauri build` regenerates all excluded content.

## Development

```bash
# Install frontend dependencies
npm install

# Dev mode (hot reload)
npm run tauri dev

# Build
npm run tauri build

# Run tests (unit tests)
cd src-tauri && cargo test

# End-to-end tests (requires E: drive, manual)
cd src-tauri && cargo test e2e_migrate_scenarios -- --ignored --nocapture
```

## FAQ

**Will apps still work after migration?**

Yes. Junctions are transparent to applications. When an app accesses the original path, the OS redirects to the new location. Chrome, JetBrains, games, etc. all work normally.

**Can data be lost if something goes wrong?**

No. The migration flow is: copy → verify match → delete source → create junction. Any step failure aborts the operation. Data always has at least one complete copy. In the extreme case of junction creation failure, data is automatically copied back.

**What directories can be migrated?**

User data directories under `AppData\Local`, `AppData\Roaming`, and dot-folders directly under the user home (`.dsh`, `.gradle`, `.npm`, etc.). System directories (Microsoft, Windows, NVIDIA, etc.) are automatically excluded. Cache directories (Cache, Temp, Logs) have the lowest migration risk — use the "Safe picks" filter. Credential folders such as `.ssh` and `.aws` are visible but should be left alone.

**Does it support Windows 7 / 8?**

Windows 10 or later is required. Junctions have been supported since XP, but PowerShell 5.1 and some APIs depend on newer system versions.

## License

MIT
