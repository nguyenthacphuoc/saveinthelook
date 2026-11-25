import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptVaultText, encryptVaultText, sha256Hex } from './cryptoVault';
import { generateGitHubPagesWorkflow, sanitizeRepoPath } from './githubDeploy';

test('AES-256-GCM encryptVaultText and decryptVaultText round-trip preserves Vietnamese & Python code', async () => {
  const secret = 'mat-khau-bi-mat-2026';
  const original = `# Phân tích dữ liệu\ndef hello():\n    return "Xin chào AegisVault!"\n`;

  const encrypted = await encryptVaultText(original, secret);
  assert.equal(encrypted.algorithm, 'AES-256-GCM');
  assert.notEqual(encrypted.ciphertext, original);

  const decrypted = await decryptVaultText(encrypted, secret);
  assert.equal(decrypted, original);

  await assert.rejects(() => decryptVaultText(encrypted, 'sai-mat-khau'));
});

test('sha256Hex returns 64-char hex digest', async () => {
  const hash = await sha256Hex('print("hello")');
  assert.equal(hash.length, 64);
});

test('sanitizeRepoPath strips traversal and formats folder cleanly', () => {
  assert.equal(sanitizeRepoPath('../../etc/passwd.py', 'scripts'), 'scripts/etc/passwd.py');
  const safe = sanitizeRepoPath('/notes/todo.md', 'my-vault');
  assert.equal(safe, 'my-vault/notes/todo.md');
  assert.ok(!sanitizeRepoPath('../secret.py', 'vault').includes('..'));
});

test('generateGitHubPagesWorkflow emits valid GitHub Actions YAML', () => {
  const yml = generateGitHubPagesWorkflow('my-notes-app');
  assert.ok(yml.includes('VITE_BASE_PATH: "/my-notes-app/"'));
  assert.ok(yml.includes('actions/deploy-pages@v4'));
});
