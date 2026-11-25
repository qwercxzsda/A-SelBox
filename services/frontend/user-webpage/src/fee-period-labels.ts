/** A fee period's dates, named the same way in every Current fees table and editor. */
export const FEE_PERIOD_FROM = "Effective from";
export const FEE_PERIOD_UNTIL = "Effective until";

/** Table headings state the boundaries: the start day is included, the end day is not. */
export const FEE_PERIOD_FROM_LABEL = `${FEE_PERIOD_FROM} (inclusive)`;
export const FEE_PERIOD_UNTIL_LABEL = `${FEE_PERIOD_UNTIL} (exclusive)`;

/** The rate change's start date; the new rate applies from this day. */
export const RATE_CHANGE_FROM_LABEL = `New rate ${FEE_PERIOD_FROM.toLowerCase()} (inclusive)`;

/** A period whose end is not after its start. */
export const FEE_PERIOD_ORDER_ERROR = `${FEE_PERIOD_UNTIL} must be after ${FEE_PERIOD_FROM}.`;

/** A date input's error; the input's label names the date. */
export const FEE_DATE_ERROR = "Choose a valid date.";

/** The value of an open end date. */
export const NO_END_DATE = "No end date";

/** The editor's numbered date inputs: "Effective from 2 (inclusive)". */
export function feePeriodFromInputLabel(number: string) {
  return `${FEE_PERIOD_FROM} ${number} (inclusive)`;
}

export function feePeriodUntilInputLabel(number: string) {
  return `${FEE_PERIOD_UNTIL} ${number} (exclusive)`;
}
