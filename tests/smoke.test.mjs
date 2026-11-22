import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('estrutura do projeto e arquivos importantes', () => {
  for (const p of ['index.html', 'auth.js', 'config.js', 'login-clean.css', 'mobile.css', 'manifest.webmanifest', 'assets/app-icon.svg']) {
    assert.ok(existsSync(new URL(p, root)), `Arquivo ausente: ${p}`);
  }
});

test('PWA tem escopo correto de GitHub Pages', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const scope = '/power-baterias-e-ws-baterias/';
  assert.equal(manifest.start_url, scope);
  assert.equal(manifest.scope, scope);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(i => i.src.startsWith('./assets/')));
});

test('login protegendo acesso ao painel, sem expor chave secreta', () => {
  const html = read('index.html');
  const auth = read('auth.js');
  const config = read('config.js');
  assert.match(html, /id="auth-screen"/);
  assert.match(html, /id="app-shell" hidden/);
  assert.match(html, /id="google-login"/);
  assert.match(html, /auth\.js\?v=/);
  assert.match(auth, /auth\.getUser\(/);
  assert.match(auth, /rpc\('is_authorized_user'\)/);
  assert.match(auth, /signInWithOAuth\(/);
  assert.match(auth, /flowType: 'pkce'/);
  assert.doesNotMatch(config, /sb_secret_|service_role|google_client_secret\s*=/i);
});

test('layout mobile incluído e navegação por toque', () => {
  const html = read('index.html');
  const css = read('mobile.css');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /mobile\.css/);
  assert.match(html, /nav-symbol/);
  assert.match(css, /max-width:880px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-height:44px/);
});

test('javascript embutido da interface é sintaticamente válido', () => {
  const html = read('index.html');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(inline.length > 0, 'Script embutido ausente');
  for (const [, script] of inline) {
    assert.doesNotThrow(() => new Function(script));
  }
});
