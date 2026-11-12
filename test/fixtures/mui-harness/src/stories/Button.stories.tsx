import type { Meta, StoryObj } from '@storybook/react-vite';
import Button from '@mui/material/Button';

// The real Material UI component, imported unchanged. No wrapper.
const meta = { title: 'MUI/Button', component: Button } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { variant: 'contained', children: 'Save' } };
