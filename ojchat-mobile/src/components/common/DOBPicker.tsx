import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';

import { borderRadius } from '../../theme/borderRadius';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';

interface DOBPickerProps {
  value: string;
  onChange: (isoDate: string) => void;
  error?: string;
}

export function DOBPicker({ value, onChange, error }: DOBPickerProps) {
  const [typed, setTyped] = useState('');

  const displayValue = value
    ? `${value.split('-')[2] || ''}-${value.split('-')[1] || ''}-${value.split('-')[0] || ''}`
    : '';

  const parseTyped = (text: string) => {
    const clean = text.replace(/[^0-9]/g, '');
    const formatted = clean.replace(/^(\d{2})(\d{0,2})(\d{0,4})$/, (_, dd, mm, yyyy) => {
      let result = dd;
      if (mm) result += '-' + mm;
      if (yyyy) result += '-' + yyyy;
      return result;
    });
    setTyped(formatted);

    const match = formatted.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) {
      const [, d, m, y] = match;
      const di = parseInt(d, 10),
        mi = parseInt(m, 10),
        yi = parseInt(y, 10);
      if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31 && yi >= 1900) {
        const date = new Date(yi, mi - 1, di);
        if (date.getDate() === di && date.getMonth() === mi - 1 && date.getFullYear() === yi) {
          onChange(`${y}-${m}-${d}`);
        }
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Date of Birth</Text>
      <TextInput
        style={[styles.textInput, error ? styles.textInputError : null]}
        placeholder="DD-MM-YYYY"
        placeholderTextColor={colors.textTertiary}
        value={typed || displayValue}
        onChangeText={parseTyped}
        keyboardType="numeric"
        maxLength={10}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '600', marginBottom: spacing.sm },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
  },
  textInputError: { borderColor: colors.error },
  error: { ...typography.small, color: colors.error, marginTop: spacing.xs },
});
