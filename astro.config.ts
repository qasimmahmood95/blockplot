import { defineConfig } from 'astro/config';

// Deploy target is GitHub Pages (see .github/workflows/deploy.yml). The deploy
// step stays isolated in that one file so swapping hosts later is a one-file
// change, but the Pages project-site base path has to live here.
export default defineConfig({
  site: 'https://qasimmahmood95.github.io',
  base: '/blockplot',
  output: 'static',
});
