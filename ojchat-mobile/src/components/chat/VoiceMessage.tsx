import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import AudioRecorderPlayer, { PlayBackType } from 'react-native-audio-recorder-player';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';

interface VoiceMessageProps {
  url: string;
  duration?: number;
  isOwn: boolean;
}

const WAVEFORM_BARS = 28;

export const VoiceMessage: React.FC<VoiceMessageProps> = ({ url, duration, isOwn }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [totalDuration, setTotalDuration] = useState((duration || 0) * 1000);
  const player = useRef(new AudioRecorderPlayer()).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveformAnims = useRef(
    Array.from({ length: WAVEFORM_BARS }, () => new Animated.Value(0.3)),
  ).current;

  useEffect(() => {
    return () => {
      player.removePlayBackListener();
      player.stopPlayer().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (isPlaying) {
      Animated.loop(
        Animated.sequence(
          waveformAnims.map((anim) =>
            Animated.timing(anim, {
              toValue: 0.3 + Math.random() * 0.7,
              duration: 150 + Math.random() * 200,
              easing: Easing.ease,
              useNativeDriver: false,
            }),
          ),
        ),
      ).start();
    } else {
      waveformAnims.forEach((anim) => {
        Animated.timing(anim, {
          toValue: 0.3,
          duration: 200,
          useNativeDriver: false,
        }).start();
      });
    }
  }, [isPlaying]);

  const onPlaybackStatusUpdate = (status: PlayBackType) => {
    setPosition(status.currentPosition);
    if (status.duration > 0) setTotalDuration(status.duration);
    if (status.isFinished) {
      setIsPlaying(false);
      setIsPaused(false);
      setPosition(0);
      player.removePlayBackListener();
    }
  };

  const loadAndPlay = async () => {
    try {
      if (isPlaying) {
        if (isPaused) {
          await player.resumePlayer();
          setIsPaused(false);
        } else {
          await player.pausePlayer();
          setIsPaused(true);
        }
        return;
      }

      await player.stopPlayer().catch(() => {});
      player.addPlayBackListener(onPlaybackStatusUpdate);
      await player.startPlayer(url);
      setIsPlaying(true);
      setIsPaused(false);
    } catch (err) {
      console.error('Failed to play voice message', err);
      player.removePlayBackListener();
      setIsPlaying(false);
      setIsPaused(false);
    }
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const progress = totalDuration > 0 ? position / totalDuration : 0;

  return (
    <View style={[styles.container, isOwn ? styles.ownContainer : styles.otherContainer]}>
      <TouchableOpacity style={styles.playButton} onPress={loadAndPlay} activeOpacity={0.7}>
        <Animated.View style={[styles.playIconContainer, { transform: [{ scale: pulseAnim }] }]}>
          <Ionicons
            name={isPlaying && !isPaused ? 'pause' : 'play'}
            size={18}
            color={isOwn ? colors.white : colors.primary}
          />
        </Animated.View>
      </TouchableOpacity>

      <View style={styles.waveformContainer}>
        <View style={styles.waveform}>
          {waveformAnims.map((anim, i) => {
            const barProgress = i / WAVEFORM_BARS;
            const isActive = barProgress <= progress;
            return (
              <Animated.View
                key={i}
                style={[
                  styles.waveformBar,
                  {
                    height: anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [4, 18],
                    }),
                    backgroundColor: isActive
                      ? isOwn
                        ? 'rgba(255,255,255,0.9)'
                        : colors.primary
                      : isOwn
                        ? 'rgba(255,255,255,0.3)'
                        : colors.gray300,
                  },
                ]}
              />
            );
          })}
        </View>
        <Text style={[styles.duration, isOwn ? styles.ownText : styles.otherText]}>
          {formatTime(position)} / {formatTime(totalDuration)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 200,
    maxWidth: 260,
    gap: spacing.sm,
  },
  ownContainer: {},
  otherContainer: {},
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformContainer: {
    flex: 1,
  },
  waveform: {
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
    height: 24,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    minHeight: 4,
  },
  duration: {
    ...typography.small,
    marginTop: 2,
  },
  ownText: { color: 'rgba(255,255,255,0.7)' },
  otherText: { color: colors.textSecondary },
});
