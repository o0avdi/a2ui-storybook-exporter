// Pass-through re-declaration following Storybook's official Material UI recipe
// (https://storybook.js.org/recipes/@mui/material). The full Material UI props type is kept: nothing is
// picked, omitted, renamed or narrowed, and the real component renders with every prop forwarded.
import MuiChip, { ChipProps as MuiChipProps } from '@mui/material/Chip';

export interface ChipProps extends MuiChipProps {}

export const Chip = (props: ChipProps) => <MuiChip {...props} />;
