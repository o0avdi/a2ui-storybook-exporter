import type { Meta, StoryObj } from '@storybook/react-vite';
import { Typography } from './Typography';

const meta = { title: 'MUI/Typography', component: Typography } satisfies Meta<typeof Typography>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { variant: 'body1', children: 'Hello' } };
