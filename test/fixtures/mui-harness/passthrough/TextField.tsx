// Pass-through re-declaration following Storybook's official Material UI recipe
// (https://storybook.js.org/recipes/@mui/material). The full Material UI props type is kept: nothing is
// picked, omitted, renamed or narrowed, and the real component renders with every prop forwarded.
//
// Deviation from the recipe's "interface X extends MuiXProps" form: Material UI declares TextFieldProps as a union
// of three variant-specific types (standard | filled | outlined), and TypeScript rejects an interface that extends
// a union (error TS2312). A type alias keeps the type exactly as Material UI declares it.
import MuiTextField, { TextFieldProps as MuiTextFieldProps } from '@mui/material/TextField';

export type TextFieldProps = MuiTextFieldProps;

export const TextField = (props: TextFieldProps) => <MuiTextField {...props} />;
