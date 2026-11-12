// Pass-through re-declaration following Storybook's official Material UI recipe
// (https://storybook.js.org/recipes/@mui/material). The full Material UI props type is kept: nothing is
// picked, omitted, renamed or narrowed, and the real component renders with every prop forwarded.
import MuiAlert, { AlertProps as MuiAlertProps } from '@mui/material/Alert';

export interface AlertProps extends MuiAlertProps {}

export const Alert = (props: AlertProps) => <MuiAlert {...props} />;
