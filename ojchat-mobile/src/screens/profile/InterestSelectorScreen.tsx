import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { apiClient } from '../../services/api/apiClient';
import { logger } from '../../utils/logger';
import { ENDPOINTS } from '../../constants/endpoints';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import { borderRadius } from '../../theme/borderRadius';
import { shadows } from '../../theme/shadows';

interface Interest {
  id: string;
  name: string;
  category?: string;
}

export const InterestSelectorScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { selectedIds = [] } = route?.params || {};
  const [allInterests, setAllInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('All');

  useEffect(() => {
    apiClient
      .get(ENDPOINTS.USERS.INTERESTS)
      .then((res: any) => {
        const data = res?.interests ? res : res?.data ?? res;
        const list = Array.isArray(data) ? data : data?.interests || [];
        setAllInterests(list);
        logger.debug('Interests loaded', { count: list.length });
      })
      .catch((err) => {
        logger.warn('Failed to load interests', {
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const toggleInterest = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });
  };

  const handleSave = () => {
    navigation.navigate({
      name: 'EditProfile',
      params: { selectedInterests: Array.from(selected) },
    });
  };

  const allCategories = ['All', ...new Set(allInterests.map((i) => i.category || 'Other'))];
  const filteredInterests =
    activeCategory === 'All'
      ? allInterests
      : allInterests.filter((i) => (i.category || 'Other') === activeCategory);

  // FlashList cells are single-column rows; group chips into rows that fit the
  // screen width so we get the old FlatList flexWrap grid without using
  // unsupported contentContainerStyle props (flexWrap/gap are rejected).
  const { width: screenWidth } = useWindowDimensions();
  const rows: Interest[][] = [];
  {
    const available = screenWidth - spacing.md * 2;
    let current: Interest[] = [];
    let currentWidth = 0;
    for (const interest of filteredInterests) {
      const chipWidth = Math.max(72, interest.name.length * 7.5 + 48) + spacing.sm;
      if (current.length > 0 && currentWidth + chipWidth > available) {
        rows.push(current);
        current = [];
        currentWidth = 0;
      }
      current.push(interest);
      currentWidth += chipWidth;
    }
    if (current.length > 0) rows.push(current);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Interests</Text>
        <View style={styles.counterPill}>
          <Text style={styles.counterText}>{selected.size}/10</Text>
        </View>
      </View>

      {/* Category Tabs */}
      <View style={styles.tabsContainer}>
        <FlashList
          data={allCategories}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsList}
          estimatedItemSize={40}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.tab, activeCategory === item && styles.tabActive]}
              onPress={() => setActiveCategory(item)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, activeCategory === item && styles.tabTextActive]}>
                {item}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Interests Grid */}
      <FlashList
        data={rows}
        keyExtractor={(_, index) => String(index)}
        contentContainerStyle={styles.list}
        estimatedItemSize={48}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  onPress={() => toggleInterest(item.id)}
                  activeOpacity={0.7}
                >
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  )}
                  <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      />

      {/* Save Button */}
      <View style={styles.saveContainer}>
        <TouchableOpacity
          style={[styles.saveButton, selected.size === 0 && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={selected.size === 0}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={[colors.gradientStart, colors.gradientEnd]}
            style={[styles.saveGradient, selected.size === 0 && styles.saveGradientDisabled]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.saveButtonText}>Save Interests</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.gray50 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray100,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...typography.h3, flex: 1, textAlign: 'center' },
  counterPill: {
    backgroundColor: colors.primaryOverlay,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  counterText: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '700',
  },

  // Tabs
  tabsContainer: {
    backgroundColor: colors.white,
    paddingBottom: spacing.sm,
  },
  tabsList: {
    paddingHorizontal: spacing.md,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray100,
    marginRight: spacing.xs,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.white,
    fontWeight: '600',
  },

  // List
  list: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.gray200,
    ...shadows.sm,
  },
  chipSelected: {
    backgroundColor: colors.primaryOverlay,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },

  // Save
  saveContainer: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray100,
    ...shadows.sm,
  },
  saveButton: {
    borderRadius: borderRadius.button,
    overflow: 'hidden',
  },
  saveButtonDisabled: {},
  saveGradient: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: borderRadius.button,
  },
  saveGradientDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    ...typography.button,
    color: colors.white,
  },
});
