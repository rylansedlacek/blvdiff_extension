'use strict';

// imports
const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;

function activate(context) {
  const output = vscode.window.createOutputChannel('BLVDIFF'); // extension window

  // explain flag
  const explainCmd = vscode.commands.registerCommand('blvdiff.explain', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a Python script to use the explain flag.');
      return;
    }

    const filePath = editor.document.fileName;
    const bin = await getBinary(context);
    runBlvDiff(bin, ['--explain', filePath], output);
  });

  // diff flag
  const diffCmd = vscode.commands.registerCommand('blvdiff.diff', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a Python script to use the diff flag.');
      return;
    }

    const filePath = editor.document.fileName;
    const scriptName = path.basename(filePath);
    const historyPath = await findLatest(scriptName);

    if (!historyPath) {
      vscode.window.showInformationMessage(`No script history found for ${scriptName}.`);
      return;
    }

    // ask for diff choice
    const choice = await vscode.window.showQuickPick(
      ['Side-by-side', 'Text-based'],
      { placeHolder: 'Choose Diff Mode' }
    );

    if (!choice) {
      return;
     } 

     // Text ----
    if (choice.startsWith('Text')) { 
      const bin = await getBinary(context);
      runBlvDiff(bin, ['--diff', filePath], output);
      return;
    }
     // Text ----

    // Side By Side -- 
    const oldContent = await getHistory(historyPath); 
       const newContent = editor.document.getText();    
    const oldTmp = path.join(os.tmpdir(), `${scriptName}.history.old.py`);
    const newTmp = path.join(os.tmpdir(), `${scriptName}.current.py`);

    await fsp.writeFile(oldTmp, oldContent, 'utf8');
    await fsp.writeFile(newTmp, newContent, 'utf8');

    const left = vscode.Uri.file(oldTmp); 
    const right = vscode.Uri.file(newTmp); 

    // Use VS Code's built in diff library
    await vscode.commands.executeCommand('vscode.diff', left, right, `${scriptName}: Previous Version <-> Current Version`);
    // Side By Side -- 
  });
   

  // setup for the Meta Llama stuf
  const setupCmd = vscode.commands.registerCommand('blvdiff.setup', async () => {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your API key',
      ignoreFocusOut: true,
      password: true // make it secret
    });

    if (!apiKey) {
      vscode.window.showInformationMessage('API Setup cancelled.');
      return;
    }

    const bin = await getBinary(context);
    output.clear();
      output.show(true);

    const proc = spawn(bin, ['setup'], { shell: false });
    proc.stdout.on('data', d => output.append(d.toString()));
    proc.stderr.on('data', d => output.append(d.toString()));

    proc.on('error', err => vscode.window.showErrorMessage(`Setup Error: ${err.message}`));
    proc.on('close', code => output.appendLine(`\nExited with code ${code}`)); // alert good

    // send API key to Rust
    proc.stdin.write(apiKey + '\n');
    proc.stdin.end();
  });
  context.subscriptions.push(explainCmd, diffCmd, setupCmd, output);
}

// get the binary for each platform
async function getBinary(context) {
  const configured = vscode.workspace.getConfiguration('blvflag').get('binaryPath');

  if (configured && configured.trim()) {
    return configured.trim();
  }

  const platform = process.platform;
  const arch = process.arch;

  let binName;
  if (platform === 'win32') {
    binName = 'blvflag.exe';
  } else {
    binName = 'blvflag';
  }

  const candidate = path.join(context.extensionPath, 'bin', `${platform}-${arch}`, binName);

  try {
    await fsp.access(candidate, fs.constants.X_OK);
    return candidate;
  } catch (err) {
    return 'blvflag'; // fallback path
  }
}


// run the Rust Binary
function runBlvDiff(bin, args, output) {
  output.clear();
  output.show(true);
  const proc = spawn(bin, args, { shell: false });

  proc.stdout.on('data', d => output.append(d.toString()));
  proc.stderr.on('data', d => output.append(d.toString()));

  proc.on('error', err => vscode.window.showErrorMessage(`BLVDIFF error: ${err.message}`));
  proc.on('close', code => output.appendLine(`\nExited with code ${code}`));
}


// find latest from err_history and std_history just like in RUst
async function findLatest(scriptName) {
  const baseName = scriptName.replace(/\.py$/, '');
  const baseHistDir = path.join(os.homedir(), 'blvflag', 'tool', 'history');
  const dirs = ['err_history', 'std_history'];

  let candidates = [];

  for (const dir of dirs) {
    const histDir = path.join(baseHistDir, dir);
    try {
      const files = await fsp.readdir(histDir);
      const matches = files
        .filter(f => f.startsWith(baseName + '_') && f.endsWith('.json'))
        .map(f => ({ file: path.join(histDir, f), mtime: fs.statSync(path.join(histDir, f)).mtime }));
      candidates = candidates.concat(matches);
    } catch {
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].file;
}

// reads the file that we get back
async function getHistory(historyFile) {
  const raw = await fsp.readFile(historyFile, 'utf8');
  try {
    const obj = JSON.parse(raw);

    if (typeof obj === 'string') {
      return obj;
    }
    if (obj.content) {
      return obj.content;
    }
    if (obj.text) {
       return obj.text;
    }

    return raw;
  } catch {
    return raw;
  }
}

function deactivate() {}
module.exports = { activate, deactivate };
