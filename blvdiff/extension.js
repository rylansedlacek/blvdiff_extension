'use strict';

// imports
const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;

function activate(context) {
  const output = vscode.window.createOutputChannel('BLVDIFF');

  //explain
  const explainFlag = vscode.commands.registerCommand('blvdiff.explain', 
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a Python script of notebook to use the explain flag.');
        return;
      }
      const filePath = await getScriptPath(editor.document);
      const b = await getBinary(context);
      runBlvDiff(b, ['--explain', filePath], output);
    });

  // diff flag
  const diffFlag = vscode.commands.registerCommand('blvdiff.diff', 
    async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a Python script or notebook to use the diff flag.');
      return;
    }

  const filePath = await getScriptPath(editor.document);
    const scriptName = path.basename(filePath);
    const historyPath = await findLatest(scriptName);

    if (!historyPath) { // none found
      vscode.window.showInformationMessage(`No script history found for ${scriptName}.`);
      return;
    }

    // ask for diff choice
    const choice = await vscode.window.showQuickPick(
      ['Side-by-side', 'Text-based'],
      { placeHolder: 'Choose Diff Mode' }
    );

    if (!choice) { return; }

    // here we run the text based 
    if ( choice.startsWith('Text'))    {
      const bin = await getBinary(context);
      runBlvDiff(bin, ['--diff', filePath], output);
      return;
    }

    // otherwise more complex vscode diff
    const oldContent = await getHistory(historyPath); // more heavy lifting
    const newContent = editor.document.getText();

    const oldTmp = path.join(os.tmpdir(), `${scriptName}.old.py`);
    const newTmp = path.join(os.tmpdir(), `${scriptName}.current.py`);

    await fsp.writeFile(oldTmp, oldContent, 'utf8');
    await fsp.writeFile(newTmp, newContent, 'utf8');
    const left = vscode.Uri.file(oldTmp);
    const right = vscode.Uri.file(newTmp);

    await vscode.commands.executeCommand('vscode.diff', left, right, `${scriptName}: Previous Version <-> Current Version`);
  }); // diff

  // revert 
  const revertFlag = vscode.commands.registerCommand('blvdiff.revert', 
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a Python script of notebook to use the revert flag.');
        return;
      }
      const filePath = await getScriptPath(editor.document);
      const b = await getBinary(context);
      runBlvDiff(b, ['--revert', filePath], output);
    });

  // setup command for API key
const setupCmd = vscode.commands.registerCommand('blvdiff.setup', async () => {
  const authToken = await vscode.window.showInputBox({
    prompt: 'Enter your Auth Token',
    ignoreFocusOut: true,
  });

  if (!authToken) { vscode.window.showInformationMessage('Setup cancelled'); return;}

  const bin = await getBinary(context);
  output.clear();
  output.show(true);

  const proc = spawn(bin, ['setup'], { shell: false });
  proc.stdout.on('data', d => output.append(d.toString()));
  proc.stderr.on('data', d => output.append(d.toString()));
  proc.on('error', err => {
    vscode.window.showErrorMessage(`Setup Error: ${err.message}`);
  });

  // send auth to rust
  proc.stdin.write(authToken + '\n');
  proc.stdin.end();
});

  context.subscriptions.push(explainFlag, diffFlag, revertFlag, setupCmd, output);
} // end activation events

async function getScriptPath(document) {
  if (document.languageId === 'python' && document.uri.fsPath.endsWith('.ipynb')) { 
    // take notebook cells and create a tmp py file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, 'temp.py');
    const text = document.getText();
    await fsp.writeFile(tempFile, text, 'utf8'); // save
    return tempFile;
  } else {
    return document.uri.fsPath; // otherwise its just python normal file
  }
}

// get binary path for the current platform
async function getBinary(context) {
  const configured = vscode.workspace.getConfiguration('blvflag').get('binaryPath');
  if (configured && configured.trim()) {
    return configured.trim();
  }

  const platform = process.platform;
  const arch = process.arch;

  let binName;
  if (platform === 'win32') { // TODO windows support add binary
    binName = 'blvflag.exe';
  } else {
    binName = 'blvflag';
  }

  const a = path.join(context.extensionPath, 'bin', `${platform}-${arch}`, binName);

  try {
    await fsp.access(a, fs.constants.X_OK);
    return a;
  } catch (err) {
    return 'blvflag'; // fallback to PATH
  }
}

// run the blvflag binary with args and show output in the output channel
function runBlvDiff(bin, args, output) {
  output.clear();
  output.show(true);
  const proc = spawn(bin, args, { shell: false });

  proc.stdout.on('data', d => output.append(d.toString()));
  proc.stderr.on('data', d => output.append(d.toString()));
  proc.on('error', err => vscode.window.showErrorMessage(`BLVDIFF error: ${err.message}`));
}

async function findLatest(scriptName) {
  const baseName = scriptName.replace(/\.py$/, ''); // confusing but just cuts off .py part
  const baseHistDir = path.join(os.homedir(), 'blvflag', 'tool', 'history'); // User/Home/Blvflag/tool/history
  const dirs = ['err_history', 'std_history']; // one of these

  let ops = []; 
  for (const dir of dirs) {
    const histDir = path.join(baseHistDir, dir);
    try {
      const files = await fsp.readdir(histDir);
      const matches = files
        .filter(f => f.startsWith(baseName + '_') && f.endsWith('.json'))
        .map(f => ({ file: path.join(histDir, f), mtime: fs.statSync(path.join(histDir, f)).mtime }));
      ops = ops.concat(matches);
    } catch {
      // ignore errors if dir doesn't exist
    }
  }

  if (ops.length ===   0) { return null;}
  ops.sort((a, b) => b.mtime - a.mtime); // find newest
  return ops[0].file;
}

// read the content of a script
async function getHistory(historyFile) {
  const raw = await fsp.readFile(historyFile, 'utf8');
  try {
    const obj = JSON.parse(raw);

    if (typeof obj === 'string') {return obj;}
    if (obj.content) {return obj.content;}
    if (obj.text) {return obj.text;}

    return raw;
  } catch {
    return raw;
  }
}

function deactivate() {}
module.exports = { activate, deactivate };
