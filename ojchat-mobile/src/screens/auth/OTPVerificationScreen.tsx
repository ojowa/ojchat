import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { authApi } from '../../services/api/authApi';
import { useAppStore } from '../../store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import { borderRadius } from '../../theme/borderRadius';

interface OTPScreenProps {
  route: any;
  navigation: any;
}

export const OTPVerificationScreen: React.FC<OTPScreenProps> = ({ route, navigation }) => {
  const { identifier, purpose } = route.params;
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const setUser = useAppStore((s) => s.setUser);
  const setTokens = useAppStore((s) => s.setTokens);
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      // apiClient unwraps { success, data }, so this is the inner payload.
      const res: any = await authApi.verifyOtp(identifier, code, purpose);
      if (res?.verified) {
        if (res.user && res.tokens?.accessToken) {
          setUser(res.user);
          setTokens(res.tokens.accessToken, res.tokens.refreshToken);
          // RootNavigator navigates to 'Main' when isAuthenticated flips true.
          setAuthenticated(true);
        } else {
          setNotice('Verified! Please sign in to continue.');
          navigation.replace('Login');
        }
      } else {
        setError('Verification failed. Please try again.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    setNotice('');
    try {
      await authApi.sendOtp('email', purpose, identifier);
      setNotice('A new code has been sent to your email.');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Could not resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Verify Code</Text>
        <Text style={styles.subtitle}>Enter the 6-digit code sent to {identifier}</Text>
        <View style={styles.otpContainer}>
          {otp.map((digit, index) => (
            <TextInput
              key={index}
              style={styles.otpInput}
              value={digit}
              onChangeText={(text) => {
                const newOtp = [...otp];
                newOtp[index] = text.slice(-1);
                setOtp(newOtp);
                setError('');
              }}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
            />
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Button title="Verify" onPress={handleVerify} loading={loading} />
        <Button
          title={resending ? 'Sending…' : 'Resend Code'}
          variant="ghost"
          onPress={handleResend}
          disabled={resending}
        />
        <Button
          title="Back"
          variant="ghost"
          onPress={() => navigation.goBack()}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.white },
  container: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  title: { ...typography.h1, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  otpInput: {
    flex: 1,
    maxWidth: 56,
    height: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    textAlign: 'center',
    ...typography.h2,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  notice: {
    ...typography.caption,
    color: colors.success,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
