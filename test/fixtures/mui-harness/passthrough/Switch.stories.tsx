import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch } from './Switch';

const meta = { title: 'MUI/Switch', component: Switch } satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { defaultChecked: true } };
