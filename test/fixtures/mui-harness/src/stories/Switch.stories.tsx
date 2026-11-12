import type { Meta, StoryObj } from '@storybook/react-vite';
import Switch from '@mui/material/Switch';

// The real Material UI component, imported unchanged. No wrapper.
const meta = { title: 'MUI/Switch', component: Switch } satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { defaultChecked: true } };
