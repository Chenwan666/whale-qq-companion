// DSH 0.2 exposes both the persisted override and a live plugin snapshot.
// A volatile field can be written while the snapshot still has its old value.
// Honour an explicitly stored setting, including an intentional empty string.
export function settingsField(namespace, field) {
  if(namespace?.user && Object.hasOwn(namespace.user,field))return namespace.user[field];
  return namespace?.value?.[field];
}
