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
- **Workflow Details**: Dedicated view showing comprehensive metadata, repository links, and build frequency.

### 🔨 Build Monitoring & Analysis
- **Unified Tree View**: A hierarchical view (Workflows → Build Runs → Build Actions → Issues & Test Results).
- **Issue Reporting**: Drill down into any build action to see identified issues, including `ANALYZER_WARNING`, `ERROR`, `TEST_FAILURE`, and `WARNING`.
- **Test Results Integration**: Drill down into specific test actions to see individual test class results (Passed, Failed, Skipped) with failure messages and durations.
- **Detailed Diagnostics**: View file locations and line numbers for build issues directly in the tree view tooltips.
- **Real-time Status**: Automatic polling with instant desktop notifications for build completions, failures, or cancellations.
- **Status Bar Integration**: At-a-glance status of active builds in your VS Code status bar.
- **Custom Sorting**: Toggle between newest-first and oldest-first build run views.

### 📊 Build Actions & Logs
- **Action Inspection**: Inspect individual build steps (actions) and their specific status.
- **Timing & Progress**: View detailed start times, durations, and execution progress.
- **Build Logs Viewer**: View detailed build logs for any completed build action directly in VS Code, similar to GitHub Actions or CircleCI.
- **Real-time Log Access**: Download and display logs from Xcode Cloud artifacts with automatic file size formatting.
- **Diagnostic Reporting**: Access detailed issue reports and logs directly from build actions.

### 🎛️ Quick Actions
- **Trigger Build**: Start new builds with smart branch/tag/pull-request discovery.
- **Cancel Build**: Stop running builds with a single click.

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

1. Expand a workflow to see its **Build Runs**.
2. Expand a build run to see its **Build Actions**.
3. Right-click any completed build action and select **"View Build Logs"** to see the full logs in the Output panel.
4. Expand any finished action to see **Issues** (Errors, Warnings, Analyzer results).
5. For **TEST** actions, expand them further to see individual **Test Results** including failure details.

## ⚙️ Commands

| Command | Description |
|---------|-------------|
| `Xcode Cloud: Configure App Store Connect Credentials` | Set up your API credentials |
| `Xcode Cloud: Create Workflow` | Launch the workflow creator UI |
| `Xcode Cloud: Edit Workflow` | Modify an existing workflow configuration |
| `Xcode Cloud: Delete Workflow` | Permanently remove a workflow |
| `Xcode Cloud: Trigger Build` | Start a new build with ref selection |
| `Xcode Cloud: Cancel Build` | Stop an active build run |
| `Xcode Cloud: View Build Logs` | Display detailed logs for a build action |
| `Xcode Cloud: View Workflow Details` | Show metadata in the details panel |
| `Xcode Cloud: Toggle Sort Order` | Switch between ASC/DESC build history |
| `Xcode Cloud: Open in App Store Connect` | Open the dashboard in your browser |

## 🔒 Security

- **Encryption**: Credentials are stored using VS Code's **Secret Storage** (OS-level keychain).
- **Local Generation**: API Tokens (JWT) are signed locally using `jose` — keys never leave your machine.
- **Zero Privacy Leak**: All communication stays strictly between your machine and Apple's API servers.

## 📝 API Reference

This extension utilizes the [App Store Connect API v1](https://developer.apple.com/documentation/appstoreconnectapi) endpoints:

- `GET /v1/ciProducts` - Product discovery.
- `GET /v1/ciWorkflows` - Workflow CRUD operations.
- `GET /v1/ciBuildRuns` - Build history and tracking.
- `GET /v1/ciBuildActions` - Action/step monitoring.
- `GET /v1/ciBuildActions/{id}/artifacts` - Fetch build artifacts and logs.
- `GET /v1/ciArtifacts/{id}` - Get artifact download URLs.
- `GET /v1/ciBuildActions/{id}/testResults` - Individual test result analysis.
- `GET /v1/ciBuildActions/{id}/issues` - Xcode Cloud build issues reporting.
- `GET /v1/scmRepositories` & `/v1/scmGitReferences` - Repository and branch management.

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a Pull Request on [GitHub](https://github.com/TJMusiitwa/vscode-xcode-cloud-control).

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Inspired by the [GitHub Actions](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-github-actions) extension.
- Built with [jose](https://github.com/panva/jose) and [undici](https://github.com/nodejs/undici).