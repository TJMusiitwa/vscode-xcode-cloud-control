import * as vscode from 'vscode';
import { AppStoreConnectClient } from '../appstoreconnect/client';

/**
 * WorkflowEditorPanel manages a webview panel for creating/editing workflows
 */
export class WorkflowEditorPanel {
    public static currentPanel: WorkflowEditorPanel | undefined;
    private static readonly viewType = 'workflowEditor';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    // Workflow data
    private _mode: 'create' | 'edit';
    private _workflowId?: string;
    private _workflowData?: any;
    private _productId?: string;

    // Cached data for dropdowns
    private _xcodeVersions: any[] = [];
    private _macOsVersions: any[] = [];
    private _repositories: any[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private client: AppStoreConnectClient,
        mode: 'create' | 'edit',
        workflowId?: string,
        productId?: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._mode = mode;
        this._workflowId = workflowId;
        this._productId = productId;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'save':
                        await this._handleSave(message.data);
                        return;
                    case 'cancel':
                        this._panel.dispose();
                        return;
                    case 'requestData':
                        await this._sendWorkflowData();
                        return;
                    case 'xcodeVersionChanged':
                        await this._loadMacOsVersions(message.xcodeVersionId);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Create or show the workflow editor panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        client: AppStoreConnectClient,
        mode: 'create' | 'edit',
        workflowId?: string,
        workflowName?: string,
        productId?: string
    ) {
        const column = vscode.ViewColumn.One;

        // If we already have a panel, dispose it and create a new one
        if (WorkflowEditorPanel.currentPanel) {
            WorkflowEditorPanel.currentPanel._panel.dispose();
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            WorkflowEditorPanel.viewType,
            mode === 'create' ? 'Create Workflow' : `Edit: ${workflowName || 'Workflow'}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        WorkflowEditorPanel.currentPanel = new WorkflowEditorPanel(
            panel, extensionUri, client, mode, workflowId, productId
        );
    }

    private async _loadDropdownData() {
        try {
            // Load Xcode versions
            const xcodeResponse = await this.client.listXcodeVersions({ limit: 50 });
            this._xcodeVersions = (xcodeResponse?.data || []).map((v: any) => ({
                id: v.id,
                name: v.attributes?.name || v.id,
                testDestinations: v.attributes?.testDestinations || []
            }));

            // Load repositories for the product
            if (this._productId) {
                const repoResponse = await this.client.listRepositories(this._productId);
                this._repositories = (repoResponse?.data || []).map((r: any) => ({
                    id: r.id,
                    name: r.attributes?.repositoryName || r.attributes?.httpCloneUrl || r.id
                }));
            }

            // Load macOS versions for the first Xcode version
            if (this._xcodeVersions.length > 0) {
                await this._loadMacOsVersions(this._xcodeVersions[0].id);
            }
        } catch (err: any) {
            console.error('Failed to load dropdown data:', err);
        }
    }

    private async _loadMacOsVersions(xcodeVersionId: string) {
        try {
            const macOsResponse = await this.client.listMacOsVersions(xcodeVersionId);
            this._macOsVersions = (macOsResponse?.data || []).map((v: any) => ({
                id: v.id,
                name: v.attributes?.name || v.attributes?.version || v.id
            }));

            // Send updated macOS versions to webview
            this._panel.webview.postMessage({
                command: 'updateMacOsVersions',
                versions: this._macOsVersions
            });
        } catch (err: any) {
            console.error('Failed to load macOS versions:', err);
        }
    }

    private async _sendWorkflowData() {
        // Load dropdown data first
        await this._loadDropdownData();

        if (this._mode === 'edit' && this._workflowId) {
            try {
                const response = await this.client.getWorkflow(this._workflowId);
                this._workflowData = response?.data;
                this._panel.webview.postMessage({
                    command: 'loadData',
                    mode: this._mode,
                    data: this._workflowData?.attributes || {},
                    xcodeVersions: this._xcodeVersions,
                    macOsVersions: this._macOsVersions,
                    repositories: this._repositories
                });
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to load workflow: ${err?.message}`);
            }
        } else {
            // Send empty data for create mode
            this._panel.webview.postMessage({
                command: 'loadData',
                mode: this._mode,
                data: {
                    name: '',
                    description: '',
                    isEnabled: true,
                    clean: false,
                    isLockedForEditing: false,
                    containerFilePath: '',
                    branchStartCondition: {
                        source: {
                            isAllMatch: false,
                            patterns: [{ pattern: 'main', isPrefix: false }]
                        },
                        autoCancel: true
                    },
                    actions: [{
                        name: 'Build',
                        actionType: 'BUILD',
                        scheme: '',
                        platform: 'IOS',
                        isRequiredToPass: true
                    }]
                },
                xcodeVersions: this._xcodeVersions,
                macOsVersions: this._macOsVersions,
                repositories: this._repositories
            });
        }
    }

    private async _handleSave(formData: any) {
        try {
            if (this._mode === 'create') {
                if (!this._productId) {
                    vscode.window.showErrorMessage('Product ID is required to create a workflow');
                    return;
                }

                // Validate required fields
                if (!formData.repositoryId) {
                    vscode.window.showErrorMessage('Repository is required');
                    return;
                }
                if (!formData.xcodeVersionId) {
                    vscode.window.showErrorMessage('Xcode version is required');
                    return;
                }
                if (!formData.macOsVersionId) {
                    vscode.window.showErrorMessage('macOS version is required');
                    return;
                }

                // Build the branch start condition
                const branchStartCondition = formData.branchPattern ? {
                    source: {
                        isAllMatch: false,
                        patterns: formData.branchPattern.split(',').map((p: string) => ({
                            pattern: p.trim(),
                            isPrefix: formData.branchIsPrefix || false
                        }))
                    },
                    filesAndFoldersRule: {
                        mode: 'START_IF_ANY_FILE_MATCHES',
                        matchers: []
                    },
                    autoCancel: formData.autoCancel ?? true
                } : undefined;

                // Build actions array
                const actions = formData.actions?.length > 0 ? formData.actions : [{
                    name: formData.actionName || 'Build',
                    actionType: formData.actionType || 'BUILD',
                    scheme: formData.scheme || '',
                    platform: formData.platform || 'IOS',
                    isRequiredToPass: formData.isRequiredToPass ?? true
                }];

                await this.client.createWorkflow(
                    this._productId,
                    formData.repositoryId,
                    formData.xcodeVersionId,
                    formData.macOsVersionId,
                    {
                        name: formData.name,
                        description: formData.description,
                        isEnabled: formData.isEnabled,
                        clean: formData.clean,
                        containerFilePath: formData.containerFilePath || undefined,
                        branchStartCondition,
                        manualBranchStartCondition: { source: 'ALL_BRANCHES' },
                        actions
                    }
                );
                vscode.window.showInformationMessage(`Workflow "${formData.name}" created successfully`);
            } else if (this._mode === 'edit' && this._workflowId) {
                await this.client.updateWorkflow(this._workflowId, {
                    name: formData.name,
                    description: formData.description,
                    isEnabled: formData.isEnabled,
                    clean: formData.clean
                });
                vscode.window.showInformationMessage(`Workflow "${formData.name}" updated successfully`);
            }

            // Close the panel and refresh the tree
            this._panel.dispose();
            vscode.commands.executeCommand('xcodecloud.refreshWorkflows');

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to save workflow: ${err?.message || String(err)}`);
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Workflow Editor</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
        }
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            font-size: 1.5em;
            margin-bottom: 20px;
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        .form-group {
            margin-bottom: 16px;
        }
        .form-row {
            display: flex;
            gap: 16px;
        }
        .form-row .form-group {
            flex: 1;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            color: var(--vscode-foreground);
            font-size: 13px;
        }
        label .required {
            color: var(--vscode-errorForeground);
        }
        input[type="text"],
        textarea,
        select {
            width: 100%;
            padding: 8px 10px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 13px;
            box-sizing: border-box;
        }
        input[type="text"]:focus,
        textarea:focus,
        select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        textarea {
            min-height: 60px;
            resize: vertical;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        .checkbox-group label {
            margin-bottom: 0;
            font-weight: normal;
        }
        input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: var(--vscode-focusBorder);
        }
        .button-group {
            margin-top: 24px;
            display: flex;
            gap: 10px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            cursor: pointer;
            font-weight: 500;
        }
        button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        button.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .section {
            margin-bottom: 24px;
            padding: 16px;
            background-color: var(--vscode-sideBar-background);
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border);
        }
        .section h2 {
            font-size: 1.1em;
            margin-top: 0;
            margin-bottom: 16px;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .section h2::before {
            content: '';
            display: inline-block;
            width: 4px;
            height: 16px;
            background-color: var(--vscode-focusBorder);
            border-radius: 2px;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .help-text {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .action-row {
            display: flex;
            gap: 12px;
            align-items: flex-end;
            padding: 12px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            margin-bottom: 8px;
        }
        .action-row .form-group {
            margin-bottom: 0;
        }
    </style>
</head>
<body>
    <h1 id="title">Loading...</h1>
    
    <div id="loading" class="loading">
        Loading workflow data and configuration options...
    </div>
    
    <form id="workflow-form" style="display: none;">
        <div class="section">
            <h2>Basic Information</h2>
            
            <div class="form-group">
                <label for="name">Workflow Name <span class="required">*</span></label>
                <input type="text" id="name" name="name" required placeholder="e.g., Build iOS App">
            </div>
            
            <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" name="description" placeholder="Describe what this workflow does..."></textarea>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="isEnabled" name="isEnabled" checked>
                        <label for="isEnabled">Enabled</label>
                    </div>
                </div>
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="clean" name="clean">
                        <label for="clean">Clean build</label>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="section" id="environment-section">
            <h2>Environment</h2>
            
            <div class="form-row">
                <div class="form-group">
                    <label for="xcodeVersion">Xcode Version <span class="required">*</span></label>
                    <select id="xcodeVersion" name="xcodeVersion" required>
                        <option value="">Loading...</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="macOsVersion">macOS Version <span class="required">*</span></label>
                    <select id="macOsVersion" name="macOsVersion" required>
                        <option value="">Select Xcode first</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label for="repository">Repository <span class="required">*</span></label>
                <select id="repository" name="repository" required>
                    <option value="">Loading...</option>
                </select>
            </div>
            
            <div class="form-group">
                <label for="containerFilePath">Project/Workspace File</label>
                <input type="text" id="containerFilePath" name="containerFilePath" placeholder="e.g., MyProject.xcodeproj or MyWorkspace.xcworkspace">
                <div class="help-text">Relative path to your .xcodeproj or .xcworkspace file</div>
            </div>
        </div>
        
        <div class="section" id="trigger-section">
            <h2>Start Conditions</h2>
            
            <div class="form-group">
                <label for="branchPattern">Branch Pattern</label>
                <input type="text" id="branchPattern" name="branchPattern" placeholder="main, develop, feature/*" value="main">
                <div class="help-text">Comma-separated list of branch names or patterns (leave empty for all branches)</div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="branchIsPrefix" name="branchIsPrefix">
                        <label for="branchIsPrefix">Match as prefix</label>
                    </div>
                </div>
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="autoCancel" name="autoCancel" checked>
                        <label for="autoCancel">Auto-cancel superseded builds</label>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="section" id="action-section">
            <h2>Action Configuration</h2>
            
            <div class="action-row">
                <div class="form-group" style="flex: 2;">
                    <label for="actionName">Action Name</label>
                    <input type="text" id="actionName" name="actionName" placeholder="e.g., Build iOS" value="Build">
                </div>
                
                <div class="form-group" style="flex: 1;">
                    <label for="actionType">Type <span class="required">*</span></label>
                    <select id="actionType" name="actionType">
                        <option value="BUILD">Build</option>
                        <option value="TEST">Test</option>
                        <option value="ANALYZE">Analyze</option>
                        <option value="ARCHIVE" selected>Archive</option>
                    </select>
                </div>
                
                <div class="form-group" style="flex: 1;">
                    <label for="platform">Platform <span class="required">*</span></label>
                    <select id="platform" name="platform">
                        <option value="IOS" selected>iOS</option>
                        <option value="MACOS">macOS</option>
                        <option value="TVOS">tvOS</option>
                        <option value="WATCHOS">watchOS</option>
                        <option value="VISIONOS">visionOS</option>
                    </select>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label for="scheme">Scheme <span class="required">*</span></label>
                    <input type="text" id="scheme" name="scheme" required placeholder="e.g., MyApp">
                    <div class="help-text">The Xcode scheme to build</div>
                </div>
            </div>
            
            <div class="checkbox-group">
                <input type="checkbox" id="isRequiredToPass" name="isRequiredToPass" checked>
                <label for="isRequiredToPass">Required to pass</label>
            </div>
        </div>
        
        <div class="button-group">
            <button type="submit" class="primary" id="save-btn">Save Workflow</button>
            <button type="button" class="secondary" id="cancel-btn">Cancel</button>
        </div>
    </form>
    
    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            
            const form = document.getElementById('workflow-form');
            const loading = document.getElementById('loading');
            const title = document.getElementById('title');
            const xcodeVersionSelect = document.getElementById('xcodeVersion');
            const macOsVersionSelect = document.getElementById('macOsVersion');
            const repositorySelect = document.getElementById('repository');
            
            // Request initial data
            vscode.postMessage({ command: 'requestData' });
            
            // Handle Xcode version change to update macOS versions
            xcodeVersionSelect.addEventListener('change', () => {
                const selectedId = xcodeVersionSelect.value;
                if (selectedId) {
                    macOsVersionSelect.innerHTML = '<option value="">Loading...</option>';
                    vscode.postMessage({ command: 'xcodeVersionChanged', xcodeVersionId: selectedId });
                }
            });
            
            // Handle messages from extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                if (message.command === 'loadData') {
                    loading.style.display = 'none';
                    form.style.display = 'block';
                    
                    title.textContent = message.mode === 'create' ? 'Create Workflow' : 'Edit Workflow';
                    
                    // Populate Xcode versions dropdown
                    if (message.xcodeVersions && message.xcodeVersions.length > 0) {
                        xcodeVersionSelect.innerHTML = message.xcodeVersions.map(v => 
                            '<option value="' + v.id + '">' + v.name + '</option>'
                        ).join('');
                    } else {
                        xcodeVersionSelect.innerHTML = '<option value="">No versions available</option>';
                    }
                    
                    // Populate macOS versions dropdown
                    if (message.macOsVersions && message.macOsVersions.length > 0) {
                        macOsVersionSelect.innerHTML = message.macOsVersions.map(v => 
                            '<option value="' + v.id + '">' + v.name + '</option>'
                        ).join('');
                    } else {
                        macOsVersionSelect.innerHTML = '<option value="">Select Xcode first</option>';
                    }
                    
                    // Populate repositories dropdown
                    if (message.repositories && message.repositories.length > 0) {
                        repositorySelect.innerHTML = message.repositories.map(r => 
                            '<option value="' + r.id + '">' + r.name + '</option>'
                        ).join('');
                    } else {
                        repositorySelect.innerHTML = '<option value="">No repositories found</option>';
                    }
                    
                    // Populate form with data
                    document.getElementById('name').value = message.data.name || '';
                    document.getElementById('description').value = message.data.description || '';
                    document.getElementById('isEnabled').checked = message.data.isEnabled !== false;
                    document.getElementById('clean').checked = message.data.clean === true;
                    document.getElementById('containerFilePath').value = message.data.containerFilePath || '';
                    
                    // Branch pattern
                    if (message.data.branchStartCondition?.source?.patterns) {
                        const patterns = message.data.branchStartCondition.source.patterns;
                        document.getElementById('branchPattern').value = patterns.map(p => p.pattern).join(', ');
                        document.getElementById('branchIsPrefix').checked = patterns[0]?.isPrefix || false;
                    }
                    document.getElementById('autoCancel').checked = message.data.branchStartCondition?.autoCancel !== false;
                    
                    // Action configuration
                    if (message.data.actions && message.data.actions.length > 0) {
                        const action = message.data.actions[0];
                        document.getElementById('actionName').value = action.name || 'Build';
                        document.getElementById('actionType').value = action.actionType || 'BUILD';
                        document.getElementById('platform').value = action.platform || 'IOS';
                        document.getElementById('scheme').value = action.scheme || '';
                        document.getElementById('isRequiredToPass').checked = action.isRequiredToPass !== false;
                    }
                    
                    // Hide environment section in edit mode (can't change these)
                    if (message.mode === 'edit') {
                        document.getElementById('environment-section').style.display = 'none';
                        document.getElementById('trigger-section').style.display = 'none';
                        document.getElementById('action-section').style.display = 'none';
                    }
                }
                
                if (message.command === 'updateMacOsVersions') {
                    if (message.versions && message.versions.length > 0) {
                        macOsVersionSelect.innerHTML = message.versions.map(v => 
                            '<option value="' + v.id + '">' + v.name + '</option>'
                        ).join('');
                    } else {
                        macOsVersionSelect.innerHTML = '<option value="">No versions available</option>';
                    }
                }
            });
            
            // Handle form submission
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                
                const formData = {
                    name: document.getElementById('name').value,
                    description: document.getElementById('description').value,
                    isEnabled: document.getElementById('isEnabled').checked,
                    clean: document.getElementById('clean').checked,
                    containerFilePath: document.getElementById('containerFilePath').value,
                    xcodeVersionId: xcodeVersionSelect.value,
                    macOsVersionId: macOsVersionSelect.value,
                    repositoryId: repositorySelect.value,
                    branchPattern: document.getElementById('branchPattern').value,
                    branchIsPrefix: document.getElementById('branchIsPrefix').checked,
                    autoCancel: document.getElementById('autoCancel').checked,
                    actionName: document.getElementById('actionName').value,
                    actionType: document.getElementById('actionType').value,
                    platform: document.getElementById('platform').value,
                    scheme: document.getElementById('scheme').value,
                    isRequiredToPass: document.getElementById('isRequiredToPass').checked
                };
                
                vscode.postMessage({ command: 'save', data: formData });
            });
            
            // Handle cancel
            document.getElementById('cancel-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });
        })();
    </script>
</body>
</html>`;
    }

    public dispose() {
        WorkflowEditorPanel.currentPanel = undefined;

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
