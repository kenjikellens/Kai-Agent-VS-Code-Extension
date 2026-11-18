const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { resolveSafePath } = require('../out/tools/Tool.js');
const { getRegisteredTools, WriteFileTool, FetchUrlTool, RunCommandTool } = require('../out/tools/index.js');
const { SessionStore } = require('../out/SessionStore.js');

function loadMediaClass(filePath, className) {
    const code = fs.readFileSync(filePath, 'utf8');
    const context = { window: { addEventListener: () => {} }, localStorage: { getItem: () => null, setItem: () => {} }, Math, Number, String, Array, RegExp, Object, Error, console };
    vm.createContext(context);
    vm.runInContext(`${code}\nthis.__EXPORTED__ = ${className};`, context);
    return context.__EXPORTED__;
}

test('Extension resolveSafePath blocks empty workspace and sibling prefix bypass', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-ext-safe-'));
    const ws = path.join(tmpRoot, 'proj');
    const sibling = path.join(tmpRoot, 'proj-secret');
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(ws, 'ok.txt'), 'ok', 'utf8');
    fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret', 'utf8');

    try {
        assert.throws(() => resolveSafePath('ok.txt', ''), /No active workspace/i);
        assert.throws(() => resolveSafePath('../proj-secret/secret.txt', ws), /Path traversal violation/i);
        assert.equal(resolveSafePath('ok.txt', ws), path.join(fs.realpathSync(ws), 'ok.txt'));
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('Extension Ask and Agent modes without workspace exclude workspace mutation and command tools', () => {
    for (const m of ['ask', 'chat', 'agent']) {
        const names = getRegisteredTools(m, false).map(t => t.name);
        assert.equal(names.includes('run_command'), false);
        assert.equal(names.includes('write_file'), false);
        assert.equal(names.includes('delete_item'), false);
    }
});

test('Extension Planning mode blocks run_command and restricts write_file to .kai/artifacts', async () => {
    const tools = getRegisteredTools('planning', true);
    const names = tools.map(t => t.name);
    assert.equal(names.includes('run_command'), false);
    assert.equal(names.includes('delete_item'), false);
    assert.equal(names.includes('write_file'), true);

    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-ext-plan-'));
    try {
        const planWriter = new WriteFileTool('.kai/artifacts');
        const blocked = await planWriter.execute({ path: 'index.ts', content: 'x' }, { workspacePath: tmpWs });
        assert.match(blocked, /restricted to "\.kai\/artifacts\/"/);
    } finally {
        fs.rmSync(tmpWs, { recursive: true, force: true });
    }
});

test('Extension RunCommandTool honors requestCommandApproval denial', async () => {
    const tool = new RunCommandTool();
    const res = await tool.execute({ command: 'echo test' }, {
        workspacePath: process.cwd(),
        hostServices: {
            getDiagnostics: async () => '',
            getPostEditDiagnostics: async () => '',
            searchWorkspaceSymbols: async () => '',
            getConfiguration: (_s, _k, d) => d,
            askUser: async () => '',
            requestCommandApproval: async () => false
        }
    });
    assert.match(res, /Execution Cancelled/);
});

test('Extension FetchUrlTool blocks localhost and metadata SSRF targets', async () => {
    const tool = new FetchUrlTool();
    const resLocal = await tool.execute({ url: 'http://127.0.0.1:8080/' }, { workspacePath: '' });
    assert.match(resLocal, /SSRF protection/i);
    const resMeta = await tool.execute({ url: 'http://169.254.169.254/latest/meta-data/' }, { workspacePath: '' });
    assert.match(resMeta, /SSRF protection/i);
});

test('Extension MarkdownFormatter.escapeHtml escapes quotes and angle brackets', () => {
    const MarkdownFormatter = loadMediaClass(
        path.resolve(__dirname, '../media/js/MarkdownFormatter.js'),
        'MarkdownFormatter'
    );
    const fmt = new MarkdownFormatter();
    assert.equal(fmt.escapeHtml(`<script>"'&`), '&lt;script&gt;&quot;&#39;&amp;');
});

test('Extension SessionStore waits for async load before saveChat', async () => {
    let saved = null;
    const store = new SessionStore({
        load: async () => {
            await new Promise(r => setTimeout(r, 20));
            return { old: { id: 'old', title: 'Old', messages: [], mode: 'agent', model: 'm', thinking: true, timestamp: 1 } };
        },
        save: async (data) => { saved = data; }
    });
    await store.saveChat({ id: 'new', title: 'New', messages: [], mode: 'agent', model: 'm', thinking: true, timestamp: 2 });
    assert.ok(saved.old);
    assert.ok(saved.new);
});
