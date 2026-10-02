import {
  Accordion,
  Alert,
  Button,
  Drawer,
  Input,
  InputWrapper,
  Paper,
  Table,
  Tabs,
  createTheme,
  DEFAULT_THEME,
} from "@mantine/core";

const cyan = DEFAULT_THEME.colors.cyan;

/** Shared visual defaults; individual views retain their own information layout. */
export const appTheme = createTheme({
  primaryColor: "cyan",
  primaryShade: 8,
  // Small links and actions remain readable on white, canvas, and tinted surfaces.
  colors: {
    cyan: [
      cyan[0],
      cyan[1],
      cyan[2],
      cyan[3],
      cyan[4],
      cyan[5],
      cyan[6],
      cyan[7],
      cyan[9],
      "#095d6c",
    ],
  },
  defaultRadius: "sm",
  radius: { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" },
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: { fontWeight: "600" },
  components: {
    Alert: Alert.extend({ classNames: { title: "ui-alert-title" } }),
    Paper: Paper.extend({
      defaultProps: { radius: "md" },
      classNames: { root: "ui-surface" },
    }),
    Button: Button.extend({ classNames: { root: "ui-button" } }),
    Input: Input.extend({ classNames: { input: "ui-input" } }),
    InputWrapper: InputWrapper.extend({
      classNames: { label: "ui-input-label", description: "ui-input-description" },
    }),
    Table: Table.extend({
      defaultProps: { horizontalSpacing: 12, verticalSpacing: 8, tabularNums: true },
      classNames: { table: "ui-table", th: "ui-table-heading", td: "ui-table-cell" },
    }),
    Drawer: Drawer.extend({
      classNames: { header: "ui-drawer-header", title: "ui-drawer-title", body: "ui-drawer-body" },
    }),
    Tabs: Tabs.extend({
      classNames: { list: "ui-tabs-list", tab: "ui-tabs-tab", panel: "ui-tabs-panel" },
    }),
    Accordion: Accordion.extend({
      classNames: { item: "ui-accordion-item", control: "ui-accordion-control" },
    }),
  },
});
