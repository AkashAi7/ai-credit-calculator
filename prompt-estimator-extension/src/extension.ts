import * as vscode from 'vscode';

// Input Model Pricing for AIC (per 1 Million tokens, in USD)
const modelPrices: Record<string, number> = {
    "Claude Haiku 4.5": 1.00,
    "Gemini 3 Flash": 0.50,
    "GPT-5.4 mini": 0.75,
    "GPT-4o": 2.50
};

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // 1. Sidebar Webview Provider
    const provider = new PromptSandboxProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('prompt-estimator.sidebar', provider)
    );

    // 2. Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'prompt-cost-estimator.estimate';
    context.subscriptions.push(statusBarItem);

    // Register a command to click and show a popup with details
    context.subscriptions.push(vscode.commands.registerCommand('prompt-cost-estimator.estimate', () => {
        const config = vscode.workspace.getConfiguration('promptCostEstimator');
        const model = config.get<string>('model') || "Claude Haiku 4.5";
        
        vscode.window.showInformationMessage(`Est. Input Tokens: ${lastTokens} | Model: ${model} | Cost: ${lastAIC.toFixed(2)} AIC`);
    }));

    // Listen for text selection changes to update the live AIC cost
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateEstimation));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateEstimation));

    // Register Chat Participant
    const participant = vscode.chat.createChatParticipant('prompt-cost-estimator.estimate', async (request, contextRequest, response, token) => {
        let totalText = request.prompt;
        
        // Add text from attached references (#files, #selection)
        for (const ref of request.references) {
            if (typeof ref.value === 'string') {
                totalText += "\n" + ref.value;
            } else if (ref.value instanceof vscode.Uri) {
                try {
                    const doc = await vscode.workspace.openTextDocument(ref.value);
                    totalText += "\n" + doc.getText();
                } catch (e) {
                    console.error("Could not read reference", e);
                }
            } else if (ref.value instanceof vscode.Location) {
                try {
                    const doc = await vscode.workspace.openTextDocument(ref.value.uri);
                    totalText += "\n" + doc.getText(ref.value.range);
                } catch (e) {
                    console.error("Could not read location", e);
                }
            }
        }

        const tokens = Math.ceil(totalText.length / 4);
        
        const config = vscode.workspace.getConfiguration('promptCostEstimator');
        const model = config.get<string>('model') || "Claude Haiku 4.5";
        const pricePerMillion = modelPrices[model] || 1.00;
        const costUsd = (tokens / 1000000) * pricePerMillion;
        const aic = costUsd * 100;
        const aicDisplay = aic < 0.01 ? '<0.01' : aic.toFixed(2);

        response.markdown(`**Tokens:** \`${tokens}\`  \n**Model:** \`${model}\`  \n**Estimated Cost:** \`${aicDisplay} AIC\``);
    });

    participant.iconPath = new vscode.ThemeIcon('sparkle');
    context.subscriptions.push(participant);

    // Initial update
    updateEstimation();
}

let lastTokens = 0;
let lastAIC = 0;

function updateEstimation() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        statusBarItem.hide();
        return;
    }

    const selection = editor.selection;
    let text = editor.document.getText(selection);
    
    // If no text is selected, estimate the entire active file as context
    if (!text || text.trim() === '') {
        text = editor.document.getText();
    }
    
    if (!text || text.trim() === '') {
        statusBarItem.text = `$(sparkle) 0 Tokens / 0.00 AIC`;
        statusBarItem.tooltip = "Open a file or select text to estimate your prompt's usage cost";
        statusBarItem.show();
        lastTokens = 0;
        lastAIC = 0;
        return;
    }

    // Heuristic: ~4 characters per token for English text/code
    const tokens = Math.ceil(text.length / 4);
    
    // Fetch pricing configuration
    const config = vscode.workspace.getConfiguration('promptCostEstimator');
    const model = config.get<string>('model') || "Claude Haiku 4.5";
    const pricePerMillion = modelPrices[model] || 1.00;

    // Calculate Cost in USD: (tokens / 1,000,000) * input price
    const costUsd = (tokens / 1000000) * pricePerMillion;
    
    // AIC Translation: 1 credit = $0.01 -> multiply by 100
    const aic = costUsd * 100;

    lastTokens = tokens;
    lastAIC = aic;

    const aicDisplay = aic < 0.01 ? '<0.01' : aic.toFixed(2);
    
    statusBarItem.text = `$(sparkle) ${tokens} Tokens ≈ ${aicDisplay} AIC`;
    statusBarItem.tooltip = `Calculated using ${model}. (Drag and select text you intend to prompt)`;
    statusBarItem.show();
}

class PromptSandboxProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = { enableScripts: true };

        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'fetchActiveContext') {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const text = editor.document.getText();
                    webviewView.webview.postMessage({ command: 'contextFetched', text, fileName: editor.document.fileName.split(/[/\\]/).pop() });
                } else {
                    webviewView.webview.postMessage({ command: 'contextFetched', text: '', fileName: 'No active file' });
                }
            }
        });

        webviewView.webview.html = this.getHtml();
    }

    private getHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-foreground); }
        textarea { width: 100%; height: 150px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 8px; margin-bottom: 10px; box-sizing: border-box; resize: vertical; }
        .context-box { font-size: 12px; opacity: 0.8; margin-bottom: 10px; background: var(--vscode-editor-background); padding: 5px; border-radius: 4px; border: 1px dashed var(--vscode-widget-border); max-height: 100px; overflow-y: auto;}
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 12px; cursor: pointer; width: 100%; border-radius: 4px; margin-bottom: 10px; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .stats { background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); padding: 15px; border-radius: 6px; text-align: center; }
        .metric { font-size: 20px; font-weight: bold; margin: 5px 0; color: var(--vscode-textLink-foreground); }
    </style>
</head>
<body>
    <h3>✍️ Draft Your Prompt</h3>
    <textarea id="promptInput" placeholder="Type your prompt here..."></textarea>
    
    <button id="importContextBtn">📎 Attach Active File as Context</button>
    <div id="contextBox" class="context-box" style="display:none;"></div>
    
    <div class="stats">
        <div>Total Tokens</div>
        <div class="metric" id="tokenCount">0</div>
        <div style="margin-top: 10px;">Estimated AIC Cost (GPT-4o)</div>
        <div class="metric" id="costCount">0.00</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const promptInput = document.getElementById('promptInput');
        const tokenCount = document.getElementById('tokenCount');
        const costCount = document.getElementById('costCount');
        const importContextBtn = document.getElementById('importContextBtn');
        const contextBox = document.getElementById('contextBox');
        
        let contextText = "";
        
        function calculate() {
            const totalText = promptInput.value + "\\n" + contextText;
            const tokens = Math.ceil(totalText.length / 4);
            // hardcode fallback GPT-4o pricing for sandbox demo (2.50 per M -> 0.025 per 10k)
            const cost = (tokens / 1000000) * 2.50 * 100;

            tokenCount.innerText = tokens.toLocaleString();
            costCount.innerText = cost < 0.01 && tokens > 0 ? '<0.01' : cost.toFixed(2);
        }

        promptInput.addEventListener('input', calculate);

        importContextBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'fetchActiveContext' });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'contextFetched') {
                if(message.text) {
                    contextText = message.text;
                    contextBox.style.display = 'block';
                    contextBox.innerText = "📎 Attached: " + message.fileName + " (" + contextText.length + " chars)";
                    calculate();
                }
            }
        });
    </script>
</body>
</html>`;
    }
}

export function deactivate() {}
