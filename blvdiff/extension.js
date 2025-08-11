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
    const historyPath = await findLatest(scriptName); // call function

    if (!historyPath) {
      vscode.window.showInformationMessage(`No script history found for ${scriptName}.`);
      return;
    }

    const oldContent = await getHistory(historyPath); // get the content from last file
    const newContent = editor.document.getText();  // get the current files content

    const oldTmp = path.join(os.tmpdir(), `${scriptName}.history.old.py`); // grab old
    const newTmp = path.join(os.tmpdir(), `${scriptName}.current.py`); // grab new

    await fsp.writeFile(oldTmp, oldContent, 'utf8'); // stringify
    await fsp.writeFile(newTmp, newContent, 'utf8');

    const left = vscode.Uri.file(oldTmp); // old file
    const right = vscode.Uri.file(newTmp); // new file

    // this is really neat utilizes the VSCODE diff screen instead of the blvdiff text based version
    await vscode.commands.executeCommand('vscode.diff', left, right, `${scriptName}: Previous Version <-> Current Version`);
  });

  context.subscriptions.push(explainCmd, diffCmd, output);
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
    return 'blvflag'; // fallback to PATH file?
  }
}

// run the binary
function runBlvDiff(bin, args, output) {

  output.clear();
  output.show(true);
  const proc = spawn(bin, args, { shell: false }); // call binary from bin

  proc.stdout.on('data', d => output.append(d.toString()));
  proc.stderr.on('data', d => output.append(d.toString()));

  proc.on('error', err => vscode.window.showErrorMessage(`BLVDIFF error: ${err.message}`)); // error
  proc.on('close', code => output.appendLine(`\nExited with code ${code}`)); // exit for debug
}

async function findLatest(scriptName) {
  const baseName = scriptName.replace(/\.py$/, ''); // remove .py 

  // TODO, add support for non error diffing!
  const histDir = path.join(os.homedir(), 'blvflag', 'tool', 'history', 'err_history');

  try {
    const files = await fsp.readdir(histDir);
    const candidates = files.filter(f => f.startsWith(baseName + '_') && f.endsWith('.json'));

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => {
      const aTime = fs.statSync(path.join(histDir, a)).mtime; // get the newest time first
      const bTime = fs.statSync(path.join(histDir, b)).mtime;
      return bTime - aTime;
    });

    return path.join(histDir, candidates[0]);

  } catch {
    return null;
  }
}

// reads the file
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
