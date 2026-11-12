// Pass-through re-declaration following Storybook's official Material UI recipe
// (https://storybook.js.org/recipes/@mui/material). The full Material UI props type is kept: nothing is
// picked, omitted, renamed or narrowed, and the real component renders with every prop forwarded.
import MuiSwitch, { SwitchProps as MuiSwitchProps } from '@mui/material/Switch';

export interface SwitchProps extends MuiSwitchProps {}

export const Switch = (props: SwitchProps) => <MuiSwitch {...props} />;
