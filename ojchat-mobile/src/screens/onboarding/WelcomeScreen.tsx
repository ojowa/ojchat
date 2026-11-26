import { useNavigation } from '@react-navigation/native';
import React from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  useWindowDimensions,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '../../components/common';
import { borderRadius } from '../../theme/borderRadius';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

const WelcomeScreen: React.FC = () => {
  const { width: screenWidth } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const logoSize = Math.min(120, screenWidth * 0.3);
  const heartSize = Math.min(28, logoSize * 0.23);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.heroArea}>
            <View style={styles.logoContainer}>
              <View
                style={[
                  styles.logoCircle,
                  { width: logoSize, height: logoSize, borderRadius: logoSize / 2 },
                ]}
              >
                <View style={styles.heart}>
                  <View
                    style={[
                      styles.heartHalf,
                      { width: heartSize, height: heartSize, borderRadius: heartSize / 2 },
                      styles.heartLeft,
                    ]}
                  />
                  <View
                    style={[
                      styles.heartHalf,
                      { width: heartSize, height: heartSize, borderRadius: heartSize / 2 },
                      styles.heartRight,
                    ]}
                  />
                </View>
              </View>
              <Text
                variant="h1"
                style={[styles.logoText, { fontSize: Math.min(36, screenWidth * 0.09) }]}
              >
                OJChat
              </Text>
            </View>
          </View>

          <View style={styles.textArea}>
            <Text variant="h1" style={styles.heading} accessibilityRole="header">
              Welcome to OJChat
            </Text>
            <Text variant="body" style={styles.subtitle}>
              Join millions finding meaningful connections
            </Text>
          </View>

          <View style={styles.actions}>
            <Button
              title="Get Started"
              onPress={() => navigation.navigate('Onboarding')}
              size="large"
              style={styles.getStartedButton}
            />
            <View style={styles.loginRow}>
              <Text variant="body" style={styles.loginText}>
                Already have an account?{' '}
              </Text>
              <Pressable
                onPress={() => navigation.navigate('Login')}
                accessibilityRole="link"
                accessibilityLabel="Log in to your account"
                hitSlop={8}
                style={styles.loginLinkButton}
              >
                <Text variant="body" style={styles.loginLink}>
                  Log In
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  heroArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoCircle: {
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heart: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heartHalf: {
    backgroundColor: colors.white,
  },
  heartLeft: {
    transform: [{ rotate: '-45deg' }, { translateX: 6 }],
  },
  heartRight: {
    transform: [{ rotate: '45deg' }, { translateX: -6 }],
  },
  logoText: {
    color: colors.primary,
    fontWeight: '700',
  },
  textArea: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  heading: {
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  actions: {
    alignItems: 'center',
  },
  getStartedButton: {
    width: '100%',
    marginBottom: spacing.lg,
    borderRadius: borderRadius.button,
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loginLinkButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  loginText: {
    color: colors.textSecondary,
  },
  loginLink: {
    color: colors.primary,
    fontWeight: '600',
  },
});

export default WelcomeScreen;
