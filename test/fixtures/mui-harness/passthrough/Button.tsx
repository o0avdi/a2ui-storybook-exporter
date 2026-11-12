// Pass-through re-declaration following Storybook's official Material UI recipe
// (https://storybook.js.org/recipes/@mui/material). The full Material UI props type is kept: nothing is
// picked, omitted, renamed or narrowed, and the real component renders with every prop forwarded.
import MuiButton, { ButtonProps as MuiButtonProps } from '@mui/material/Button';

export interface ButtonProps extends MuiButtonProps {}

export const Button = (props: ButtonProps) => <MuiButton {...props} />;
