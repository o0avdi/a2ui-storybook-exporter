import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextField } from './TextField';

const meta = { title: 'MUI/TextField', component: TextField } satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { label: 'Name', variant: 'outlined' } };
