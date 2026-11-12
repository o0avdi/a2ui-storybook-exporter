import type { Meta, StoryObj } from '@storybook/react-vite';
import { Chip } from './Chip';

const meta = { title: 'MUI/Chip', component: Chip } satisfies Meta<typeof Chip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { label: 'Draft' } };
