import type { Meta, StoryObj } from '@storybook/react-vite';
import TextField from '@mui/material/TextField';

// The real Material UI component, imported unchanged. No wrapper.
const meta = { title: 'MUI/TextField', component: TextField } satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { label: 'Name', variant: 'outlined' } };
