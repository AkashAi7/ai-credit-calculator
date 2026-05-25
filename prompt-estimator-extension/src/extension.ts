import * as vscode from 'vscode';

// Input Model Pricing for AIC (per 1 Million tokens, in USD)
// 1 credit = $0.01 -> Credits = Cost * 100
const modelPrices: Record<string, number> = {
    "Claude Haiku 4.5": 1.00,
    "Gemini 3 Flash": 0.50,
    "GPT-5.4 mini": 0.75,
    "GPT-4o": 2.50
};

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // Create status bar item (always visible, sits at the bottom next to language modes)
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

export function deactivate() {}
