// Pass-through re-declaration following Storybook's official Material UI recipe
// (https://storybook.js.org/recipes/@mui/material). The full Material UI props type is kept: nothing is
// picked, omitted, renamed or narrowed, and the real component renders with every prop forwarded.
import MuiTypography, { TypographyProps as MuiTypographyProps } from '@mui/material/Typography';

export interface TypographyProps extends MuiTypographyProps {}

export const Typography = (props: TypographyProps) => <MuiTypography {...props} />;
