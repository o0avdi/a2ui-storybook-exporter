import type { Meta, StoryObj } from '@storybook/react-vite';
import Chip from '@mui/material/Chip';

// The real Material UI component, imported unchanged. No wrapper.
const meta = { title: 'MUI/Chip', component: Chip } satisfies Meta<typeof Chip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { label: 'Draft' } };
