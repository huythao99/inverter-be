// Command reported to the firmware (setting.value / schedule.schedule) while
// grid-tie ("hoà lưới") is turned OFF. The device's real configured value is
// preserved in MongoDB and served again once grid-tie is turned back ON.
export const GRID_TIE_OFF_VALUE = '99001001';
