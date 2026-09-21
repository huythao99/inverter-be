// Command reported to the firmware (setting.value / schedule.schedule) while
// grid-tie ("hoà lưới") is turned OFF. The device's real configured value is
// preserved in MongoDB and served again once grid-tie is turned back ON.
export const GRID_TIE_OFF_VALUE = '99001001';

// Command reported to the firmware for a BLACKLISTED device, so it applies the
// "off" command on its next REST pull (setting/schedule). The real stored value
// is preserved in MongoDB and served again if the device is un-blacklisted.
export const BLACKLIST_OFF_VALUE = '80001011';
