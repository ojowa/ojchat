import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
  Linking,
  StatusBar,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { Button } from '../../components/common/Button';
import { DOBPicker } from '../../components/common/DOBPicker';
import { Input } from '../../components/common/Input';
import { CONFIG_URLS } from '../../constants/config';
import { useAuth } from '../../hooks/useAuth';
import { authApi } from '../../services/api/authApi';
import { borderRadius } from '../../theme/borderRadius';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { getPasswordStrength } from '../../utils/validators';

interface RegisterScreenProps {
  navigation: any;
}

interface FormErrors {
  fullName?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENDERS = ['Male', 'Female'] as const;
const ISO_DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDob(iso: string): Date | null {
  if (!ISO_DOB_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  const date = new Date(y, m - 1, d);
  if (date.getDate() !== d || date.getMonth() !== m - 1 || date.getFullYear() !== y) return null;
  return date;
}

function formatDobDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

const STRENGTH_COLORS = { weak: colors.error, medium: colors.warning, strong: colors.success };

function validate(values: {
  fullName: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  password: string;
  confirmPassword: string;
  termsAccepted: boolean;
}): FormErrors {
  const errors: FormErrors = {};
  if (!values.fullName.trim()) errors.fullName = 'Full name is required';
  else if (values.fullName.trim().length < 2)
    errors.fullName = 'Name must be at least 2 characters';
  if (!values.email.trim()) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(values.email.trim())) errors.email = 'Enter a valid email address';
  if (!values.dateOfBirth) errors.dateOfBirth = 'Date of birth is required';
  else {
    const dob = parseIsoDob(values.dateOfBirth);
    if (!dob) errors.dateOfBirth = 'Enter a valid date';
    else {
      const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 18) errors.dateOfBirth = 'You must be at least 18';
      else if (age > 120) errors.dateOfBirth = 'Enter a valid date';
    }
  }
  if (!values.gender) errors.gender = 'Select your gender';
  if (!values.password) errors.password = 'Password is required';
  else if (values.password.length < 8) errors.password = 'At least 8 characters';
  else if (!/[A-Z]/.test(values.password) || !/[0-9]/.test(values.password))
    errors.password = 'Include 1 uppercase and 1 number';
  if (!values.confirmPassword) errors.confirmPassword = 'Confirm your password';
  else if (values.password !== values.confirmPassword)
    errors.confirmPassword = 'Passwords do not match';
  if (!values.termsAccepted) errors.terms = 'You must accept the terms';
  return errors;
}

export const RegisterScreen: React.FC<RegisterScreenProps> = ({ navigation }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const { register, loading, error: authError } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const passwordStrength = password ? getPasswordStrength(password) : null;

  const handleRegister = async () => {
    const fieldErrors = validate({
      fullName,
      email,
      dateOfBirth,
      gender,
      password,
      confirmPassword,
      termsAccepted,
    });
    setErrors(fieldErrors);
    setSubmitted(true);
    if (Object.keys(fieldErrors).length > 0 || cooldown > 0) return;

    setServerError(null);
    try {
      const result: any = await register({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        dateOfBirth,
        gender: gender.toLowerCase().replace(/[- ]/g, '_'),
      });

      // Registration requires email verification — send the OTP and route to
      // the verification screen instead of dropping the user into the app.
      if (result?.requiresEmailVerification) {
        const identifier = result.email || email.trim();
        try {
          await authApi.sendOtp('email', 'registration', identifier);
        } catch {
          /* the OTP screen has a Resend button to retry */
        }
        navigation.navigate('OTPVerification', {
          identifier,
          purpose: 'registration',
        });
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        err?.message ||
        'Registration failed';
      setServerError(msg);
      setCooldown(5);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            if (cooldownRef.current) clearInterval(cooldownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  };

  const updateField = (field: string, value: string) => {
    const updated = {
      fullName,
      email,
      dateOfBirth,
      gender,
      password,
      confirmPassword,
      termsAccepted,
    };
    (updated as any)[field] = value;
    if (field === 'fullName') setFullName(value);
    else if (field === 'email') setEmail(value);
    else if (field === 'dateOfBirth') setDateOfBirth(value);
    else if (field === 'gender') setGender(value);
    else if (field === 'password') setPassword(value);
    else if (field === 'confirmPassword') setConfirmPassword(value);
    if (submitted) setErrors(validate(updated));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle="light-content" backgroundColor={colors.gradientStart} />
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.hero}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <Ionicons name="heart" size={18} color={colors.primary} />
              </View>
              <Text style={styles.brandName}>OJCHAT</Text>
            </View>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>Meet people who make life feel more meaningful.</Text>
          </LinearGradient>

          <View style={styles.formCard}>
            <View style={styles.formIntro}>
              <Text style={styles.formTitle}>Your details</Text>
              <Text style={styles.formHint}>A few details to get you started.</Text>
            </View>

            <Input
              label="Full Name"
              placeholder="Enter your full name"
              value={fullName}
              onChangeText={(v) => updateField('fullName', v)}
              autoCapitalize="words"
              error={errors.fullName}
              style={styles.inputField}
            />
            <Input
              label="Email"
              placeholder="Enter your email"
              value={email}
              onChangeText={(v) => updateField('email', v)}
              keyboardType="email-address"
              autoCapitalize="none"
              error={errors.email}
              style={styles.inputField}
            />
            <DOBPicker
              value={dateOfBirth}
              onChange={(v) => updateField('dateOfBirth', v)}
              error={errors.dateOfBirth}
            />

            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.genderRow}>
              {GENDERS.map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.genderOption, gender === g && styles.genderSelected]}
                  onPress={() => updateField('gender', g)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: gender === g }}
                >
                  <Text style={[styles.genderText, gender === g && styles.genderTextSelected]}>
                    {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {errors.gender && <Text style={styles.fieldError}>{errors.gender}</Text>}

            <Input
              label="Password"
              placeholder="Min 8 chars, 1 uppercase, 1 number"
              value={password}
              onChangeText={(v) => updateField('password', v)}
              secureTextEntry
              error={errors.password}
              style={styles.inputField}
            />
            {passwordStrength && (
              <View style={styles.strengthRow}>
                <View style={styles.strengthTrack}>
                  <View
                    style={[
                      styles.strengthBar,
                      {
                        width:
                          passwordStrength === 'weak'
                            ? '33%'
                            : passwordStrength === 'medium'
                              ? '66%'
                              : '100%',
                        backgroundColor: STRENGTH_COLORS[passwordStrength],
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.strengthText, { color: STRENGTH_COLORS[passwordStrength] }]}>
                  {passwordStrength.charAt(0).toUpperCase() + passwordStrength.slice(1)}
                </Text>
              </View>
            )}

            <Input
              label="Confirm Password"
              placeholder="Confirm your password"
              value={confirmPassword}
              onChangeText={(v) => updateField('confirmPassword', v)}
              secureTextEntry
              error={errors.confirmPassword}
              style={styles.inputField}
            />

            <TouchableOpacity
              style={styles.termsRow}
              onPress={() => setTermsAccepted(!termsAccepted)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: termsAccepted }}
            >
              <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
                {termsAccepted && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.termsText}>
                I agree to the{' '}
                <Text style={styles.termsLink} onPress={() => Linking.openURL(CONFIG_URLS.TERMS)}>
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text style={styles.termsLink} onPress={() => Linking.openURL(CONFIG_URLS.PRIVACY)}>
                  Privacy Policy
                </Text>
              </Text>
            </TouchableOpacity>
            {errors.terms && <Text style={styles.fieldError}>{errors.terms}</Text>}

            {(authError || serverError) && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                <Text style={styles.error}>
                  {authError || serverError}
                  {cooldown > 0 ? ` (${cooldown}s)` : ''}
                </Text>
              </View>
            )}
            <Button
              title={cooldown > 0 ? `Try again in ${cooldown}s` : 'Create Account'}
              onPress={handleRegister}
              loading={loading}
              disabled={cooldown > 0}
              style={styles.button}
            />
            <Button
              title="Already have an account? Sign In"
              variant="ghost"
              onPress={() => navigation.goBack()}
              style={styles.signInButton}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.gray50 },
  container: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: spacing.xl },
  hero: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    ...typography.small,
    color: colors.whiteOverlaySoft,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    ...typography.h1,
    color: colors.white,
    fontSize: 30,
    lineHeight: 36,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.whiteOverlaySoft,
    maxWidth: 300,
  },
  formCard: {
    marginHorizontal: spacing.md,
    marginTop: -spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.gray100,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  formIntro: { marginBottom: spacing.lg },
  formTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs },
  formHint: { ...typography.caption, color: colors.textSecondary },
  inputField: { marginBottom: spacing.sm },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  genderRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  genderOption: {
    flex: 1,
    minHeight: 48,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  genderSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  genderText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  genderTextSelected: { color: colors.primary },
  fieldError: { ...typography.small, color: colors.error, marginBottom: spacing.sm },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  strengthTrack: {
    width: 64,
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: colors.gray100,
  },
  strengthBar: { height: '100%', borderRadius: 3 },
  strengthText: { ...typography.small, fontWeight: '600' },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.white, fontSize: 14, fontWeight: '700' },
  termsText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 21 },
  termsLink: { color: colors.primary, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.redLight,
  },
  error: { ...typography.caption, color: colors.error, flex: 1 },
  button: { marginTop: spacing.md, borderRadius: borderRadius.card, elevation: 2 },
  signInButton: { marginTop: spacing.xs },
});
