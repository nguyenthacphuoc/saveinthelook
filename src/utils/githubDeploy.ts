export function sanitizeRepoPath(filename: string, folder = 'vault'): string {
  const segments = filename
    .trim()
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, '_'));

  const safeFolder = folder
    .trim()
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .join('/');

  const cleanName = segments.join('/');
  if (!cleanName) return `${safeFolder || 'vault'}/untitled.txt`;
  return safeFolder ? `${safeFolder}/${cleanName}` : cleanName;
}

export function generateGitHubPagesWorkflow(repoName: string): string {
  const cleanRepo = repoName.trim().replace(/^\/+|\/+$/g, '') || 'aegis-vault-web';
  return `name: Deploy AegisVault to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - name: Install dependencies
        run: npm ci
      - name: Build static web bundle
        env:
          VITE_BASE_PATH: "/${cleanRepo}/"
        run: npm run build
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist

  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;
}

export function generateGitPushGuide(owner: string, repo: string, branch = 'main'): string {
  const safeOwner = owner.trim() || 'your-username';
  const safeRepo = repo.trim() || 'aegis-vault-web';
  const safeBranch = branch.trim() || 'main';
  return `git init
git add .
git commit -m "Deploy AegisVault web and encrypted vault"
git branch -M ${safeBranch}
git remote add origin https://github.com/${safeOwner}/${safeRepo}.git
git push -u origin ${safeBranch}`;
}
