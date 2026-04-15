# Xcode Cloud Control

[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A Visual Studio Code extension to **manage, monitor, and trigger Xcode Cloud builds** directly from your editor. Experience a workflow similar to GitHub Actions, tailored for Apple's Xcode Cloud CI/CD service.

<img src="resources/icon.png" alt="Xcode Cloud Control Logo" width="200">

## ✨ Features

### 📋 Workflow Management
- **Full CRUD Support**: Create, Edit, and Delete Xcode Cloud workflows directly within VS Code using a rich editor UI.
- **Multi-Product Support**: Automatically discovers all apps (products) in your App Store Connect account.
- **Enabled/Disabled Toggling**: Quickly enable or disable workflows without leaving your editor.
- **Workflow Details**: Dedicated view showing comprehensive metadata, repository links, build triggers, and configuration.

### 🔨 Build Monitoring & Analysis
- **Unified Tree View**: Hierarchical view (Workflows → Build Runs → Build Actions → Test Results/Issues).
- **Real-time Build Status**: Automatic polling with instant desktop notifications for build completions, failures, or cancellations.
- **Live Action Tracking**: See build actions transition from PENDING → RUNNING → COMPLETE with animated status icons.
- **Issue Reporting**: Drill down into any build action to see identified issues, including `ANALYZER_WARNING`, `ERROR`, `TEST_FAILURE`, and `WARNING`.
- **Test Results Integration**: Drill down into specific test actions to see individual test class results (Passed, Failed, Skipped) with failure messages and durations.
- **Detailed Diagnostics**: View file locations and line numbers for build issues directly in the tree view tooltips.
- **Status Bar Integration**: At-a-glance status of active builds in your VS Code status bar.
- **Custom Sorting**: Toggle between newest-first and oldest-first build run views.

### 📊 Build Timeline & Logs (GitHub Actions-like Experience)
- **Progressive Log Streaming**: Each build run gets a dedicated Output Channel that appends logs as actions complete, mimicking the GitHub Actions log stream.
- **Build Timeline**: Visualize the hierarchical breakdown of build phases, tasks, and test results on completed runs.
- **Detailed Phase/Task Breakdown** (macOS + Xcode only): Automatically parses `.xcresult` bundles for detailed phase-level timing and task execution details using `xcresulttool`.
- **Cross-Platform Fallback**: On Windows/Linux, timeline shows API-level actions with graceful fallback to ensure consistent UX across platforms.
- **Log Download & Caching**: Download full build action logs and cache them for instant re-opening on subsequent clicks.

### 🎛️ Quick Actions & Keyboard Shortcuts
- **Trigger Build**: Start new builds with smart branch/tag/pull-request discovery.
  - **Keyboard**: `Shift+Enter` (when a workflow is selected)
  - **Context Menu**: Right-click a workflow → "Trigger Build"
- **Cancel Build**: Stop running builds with a single click.
  - **Keyboard**: `Shift+Backspace` (when an active build is selected)
- **Load Timeline**: View detailed breakdown of a completed build.
  - **Keyboard**: `Ctrl+Shift+L` / `Cmd+Shift+L` (when a completed build is selected)
  - **Auto-triggers**: Automatically loads when you click a completed build run
- **Refresh Workflows**: Reload the tree.
  - **Keyboard**: `F5` (when in the Workflows view)
- **Auto-expand on Trigger**: When you trigger a build, the workflow automatically expands to reveal the new build run immediately.
- **Open in App Store Connect**: Jump directly to the Xcode Cloud dashboard in your browser.

## 🚀 Getting Started

### Prerequisites

1. **Apple Developer Account** with Xcode Cloud access.
2. **App Store Connect API Key** with **Developer** or higher access level.

### Configuration

1. Open VS Code Command Palette (`Cmd+Shift+P`).
2. Run **"Xcode Cloud: Configure App Store Connect Credentials"**.
3. Enter your **Issuer ID**, **Key ID**, and paste your **Private Key** (`.p8` file contents).

Your credentials are stored securely using VS Code's **Secret Storage** (OS keychain).

## 📖 Usage

### Managing Workflows

1. Click the **Xcode Cloud** icon in the Activity Bar.
2. Use the **+** (Plus) icon in the Workflows header to create a new workflow.
3. Right-click any workflow to **Edit** its conditions (Branch/Tag/PR triggers), actions (Build/Test/Archive), or settings.
4. View deep-dive information in the **Workflow Details** panel.

### Monitoring Builds & Tests

1. Expand a workflow to see its **Build Runs** (sorted newest-first by default).
2. Expand a build run to see its **Build Actions** (Build, Test, Archive steps).
3. Watch as actions progress: PENDING → RUNNING → COMPLETE with live status updates.
4. Each completed action automatically appends its logs to the **Output Channel** (e.g., `Xcode Cloud: Build #42`).
5. Expand a completed action to see **Issues** (Errors, Warnings, Analyzer results) and **Test Results** (for TEST actions).

### Viewing Build Logs & Timeline

1. **Automatic Log Streaming**: When you trigger a build, the log Output Channel opens automatically and streams action completion logs in real-time.
2. **Timeline Inspection**: Click on any **completed build run** — the timeline automatically loads in the **Build Timeline** panel with:
   - **macOS + Xcode**: Full phase-level breakdown of each action (Compile Sources, Link Binary, Run Tests, etc.)
   - **Windows/Linux**: API-level action summary (detailed phases unavailable without Xcode)
3. **Manual Log View**: Right-click a finished build action → "View Build Logs" to download and inspect the full log archive.

### Performance & Scalability

The extension handles large accounts gracefully:
- **Pagination**: Automatically fetches all workflows and build runs, even for accounts with 100+ items per product.
- **Rate Limiting**: Serial request queue prevents rate limit errors (429) when polling multiple active builds.
- **Caching**: Frequently-accessed data (products, workflows, versions) cached for 30-60 seconds to reduce API calls.
- **Adaptive Polling**: Polling interval increases from 15s (active builds) to 30s (idle) to balance responsiveness and API usage.

## ⚙️ Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Xcode Cloud: Configure App Store Connect Credentials` | — | Set up your API credentials (Issuer ID, Key ID, Private Key) |
| `Xcode Cloud: Create Workflow` | — | Launch the workflow creator UI |
| `Xcode Cloud: Edit Workflow` | — | Modify an existing workflow configuration |
| `Xcode Cloud: Delete Workflow` | — | Permanently remove a workflow |
| `Xcode Cloud: Trigger Build` | `Shift+Enter` | Start a new build with branch/tag/PR selection |
| `Xcode Cloud: Cancel Build` | `Shift+Backspace` | Stop an active build run |
| `Xcode Cloud: Load Build Timeline` | `Ctrl+Shift+L` / `Cmd+Shift+L` | View detailed phase/task breakdown for a completed build |
| `Xcode Cloud: View Build Logs` | — | Download and display full build action logs |
| `Xcode Cloud: View Workflow Details` | — | Show metadata in the details panel |
| `Xcode Cloud: Refresh Workflows` | `F5` | Reload the tree from the API |
| `Xcode Cloud: Toggle Sort Order` | — | Switch between newest-first and oldest-first build history |
| `Xcode Cloud: Open in App Store Connect` | — | Open the Xcode Cloud dashboard in your browser |

## ⚙️ Configuration

Configure extension behavior via VS Code Settings (`Cmd/Ctrl+,` → search "Xcode Cloud"):

| Setting | Default | Description |
|---------|---------|-------------|
| `xcodecloud.pollIntervalSeconds` | `30` | How often (in seconds) to poll for build status updates. Active builds use 15s for faster feedback. |
| `xcodecloud.enableDetailedTimeline` | `true` | Parse XCResult bundles for detailed phase/task timelines (requires macOS + Xcode installed). |
| `xcodecloud.autoShowBuildLogs` | `true` | Automatically open the build log Output Channel when a build is triggered. |

## 🔒 Security

- **Encryption**: Credentials are stored using VS Code's **Secret Storage** (OS-level keychain on macOS/Linux/Windows).
- **Local Generation**: API Tokens (JWT) are signed locally using the `jose` library — **your private key never leaves your machine**.
- **Zero Privacy Leak**: All communication stays strictly between your machine and Apple's API servers (`api.appstoreconnect.apple.com`).
- **No Telemetry**: This extension does not collect or send any telemetry or usage data.
- **No Code Execution**: Build logs and timeline data are parsed locally — no external scripts or services are invoked.

## 📝 API Reference

This extension utilizes the [App Store Connect API v1](https://developer.apple.com/documentation/appstoreconnectapi) endpoints:

- `GET /v1/ciProducts` - Product discovery.
- `GET /v1/ciWorkflows` - Workflow CRUD operations.
- `GET /v1/ciBuildRuns` - Build history and tracking.
- `GET /v1/ciBuildActions` - Action/step monitoring.
- `GET /v1/ciBuildActions/{id}/testResults` - Individual test result analysis.
- `GET /v1/ciBuildActions/{id}/issues` - Xcode Cloud build issues reporting.
- `GET /v1/scmRepositories` & `/v1/scmGitReferences` - Repository and branch management.

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a Pull Request on [GitHub](https://github.com/TJMusiitwa/vscode-xcode-cloud-control).

Before submitting, ensure:
- Code passes `npm run lint` and `npm run check-types`
- Tests pass: `npm test`
- Changes follow existing patterns in the codebase

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.

## ⚖️ Trademark & Legal Notice

**"Xcode Cloud"**, **"Xcode"**, **"App Store Connect"**, **"Apple Developer"**, and all related Apple trademarks and service marks are the property of Apple Inc. This extension is **not affiliated with, endorsed by, or sponsored by Apple Inc.**

This extension is an independent third-party tool that integrates with Apple's publicly available App Store Connect API. All product names, trademarks, and service marks belong to their respective owners.

The use of these names in this extension is for descriptive and referential purposes only and does not imply any endorsement or affiliation with Apple Inc.

## 🙏 Acknowledgments

- Inspired by the [GitHub Actions](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-github-actions) extension.
- Built with [jose](https://github.com/panva/jose) for JWT signing, [undici](https://github.com/nodejs/undici) for HTTP requests, and [yauzl](https://github.com/thejoshwolfe/yauzl) for ZIP handling.
- Special thanks to the VS Code extension community for documentation and best practices.