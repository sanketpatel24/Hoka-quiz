export function planDefinitionUpdate(existing, desired, { prune }) {
  const existingByKey = new Map(existing.fieldDefinitions.map((field) => [field.key, field]));
  const desiredKeys = new Set(desired.fieldDefinitions.map(({ key }) => key));
  const fieldDefinitions = [];
  const report = [];
  const conflicts = [];

  for (const field of desired.fieldDefinitions) {
    const current = existingByKey.get(field.key);
    if (!current) {
      fieldDefinitions.push({ create: field });
      report.push(`${field.key}: created`);
      continue;
    }

    if (current.type.name !== field.type) {
      conflicts.push(`${field.key} is ${current.type.name} in the store but must be ${field.type}`);
      continue;
    }

    const { key, name, description, required, validations } = field;
    fieldDefinitions.push({ update: { key, name, description, required, validations } });
    report.push(`${field.key}: name, description, required and validations synced`);
  }

  for (const { key } of existing.fieldDefinitions) {
    if (desiredKeys.has(key)) continue;

    if (prune) {
      fieldDefinitions.push({ delete: { key } });
      report.push(`${key}: deleted with its saved values`);
    } else {
      fieldDefinitions.push({ update: { key, required: false } });
      report.push(`${key}: no longer written, made optional. Run again with --prune to delete it and its saved values`);
    }
  }

  const definition = { fieldDefinitions, resetFieldOrder: true };
  if (existing.displayNameKey !== desired.displayNameKey) {
    definition.displayNameKey = desired.displayNameKey;
    report.push(`display name: ${existing.displayNameKey ?? 'none'} changed to ${desired.displayNameKey}`);
  }

  return { definition, report, conflicts };
}
