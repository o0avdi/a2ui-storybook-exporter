import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert } from './Alert';

const meta = { title: 'MUI/Alert', component: Alert } satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { severity: 'info', children: 'Saved.' } };
