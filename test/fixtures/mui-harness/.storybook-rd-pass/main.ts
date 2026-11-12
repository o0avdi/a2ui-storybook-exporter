import type { StorybookConfig } from '@storybook/react-vite';

// Build C: default react-docgen engine over the recipe-style pass-through files in passthrough/.
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../passthrough/*.stories.tsx'],
  features: { componentsManifest: true },
  typescript: { reactDocgen: 'react-docgen' },
};
export default config;
