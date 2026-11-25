import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  Animated,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import { borderRadius } from '../../theme/borderRadius';
import { CONFIG } from '../../constants/config';

interface ChatInputProps {
  onSend: (text: string) => void;
  onSendImage?: (uri: string) => void;
  onSendVoice?: (uri: string, duration?: number) => void;
  onSendGif?: (url: string) => void;
  onTyping?: () => void;
  replyTo?: { id: string; content: string } | null;
  onCancelReply?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onSendImage,
  onSendVoice,
  onSendGif,
  onTyping,
  replyTo,
  onCancelReply,
}) => {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer()).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    return () => {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      audioRecorderPlayer.removeRecordBackListener();
    };
  }, []);

  const startRecording = async () => {
    try {
      if (Platform.OS === 'android') {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );
        if (result !== PermissionsAndroid.RESULTS.GRANTED) return;
      }
      // On iOS the recorder prompts for microphone access itself.
      await audioRecorderPlayer.startRecorder();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimer.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      ).start();
    } catch (err) {
      console.error('Failed to start recording', err);
      setIsRecording(false);
    }
  };

  const finishRecording = async (): Promise<string | null> => {
    setIsRecording(false);
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }
    pulseAnim.setValue(1);
    audioRecorderPlayer.removeRecordBackListener();
    try {
      return await audioRecorderPlayer.stopRecorder();
    } catch (err) {
      console.error('Failed to stop recording', err);
      return null;
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    const duration = recordingDuration;
    const uri = await finishRecording();
    setRecordingDuration(0);
    if (uri && onSendVoice) onSendVoice(uri, duration);
  };

  const cancelRecording = async () => {
    if (!isRecording) return;
    await finishRecording();
    setRecordingDuration(0);
  };

  const formatRecordingTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSend = () => {
    if (text.trim()) {
      onSend(text.trim());
      setText('');
    }
  };

  const handleAttach = async () => {
    Alert.alert('Attach', 'Choose an option', [
      {
        text: '📷 Camera',
        onPress: async () => {
          if (Platform.OS === 'android') {
            const result = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.CAMERA,
            );
            if (result !== PermissionsAndroid.RESULTS.GRANTED) return;
          }
          const response = await launchCamera({ mediaType: 'photo', quality: 0.8 });
          const uri = response.didCancel ? undefined : response.assets?.[0]?.uri;
          if (uri) onSendImage?.(uri);
        },
      },
      {
        text: '🖼️ Gallery',
        onPress: async () => {
          const response = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
          const uri = response.didCancel ? undefined : response.assets?.[0]?.uri;
          if (uri) onSendImage?.(uri);
        },
      },
      {
        text: isRecording ? '⏹️ Stop Recording' : '🎤 Voice Message',
        onPress: isRecording ? stopRecording : startRecording,
      },
      {
        text: '😎 GIF',
        onPress: () => {
          // Placeholder — in production, open GIF picker
          Alert.alert('GIF', 'GIF picker coming soon');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.container}>
      {replyTo && (
        <View style={styles.replyPreview}>
          <View style={styles.replyPreviewContent}>
            <Text style={styles.replyPreviewLabel}>Replying to</Text>
            <Text style={styles.replyPreviewText} numberOfLines={1}>
              {replyTo.content}
            </Text>
          </View>
          <TouchableOpacity onPress={onCancelReply}>
            <Ionicons name="close" size={18} color={colors.gray400} />
          </TouchableOpacity>
        </View>
      )}
      {isRecording ? (
        <View style={styles.recordingRow}>
          <TouchableOpacity onPress={cancelRecording} style={styles.cancelRecordButton}>
            <Ionicons name="close" size={22} color={colors.error} />
          </TouchableOpacity>
          <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={styles.recordingTime}>{formatRecordingTime(recordingDuration)}</Text>
          <View style={styles.recordingSpacer} />
          <TouchableOpacity onPress={stopRecording} style={styles.stopRecordButton}>
            <Ionicons name="stop" size={20} color={colors.white} />
            <Text style={styles.stopRecordText}>Send</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.attachButton} onPress={handleAttach} activeOpacity={0.7}>
            <Text style={styles.attachIcon}>+</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(t) => {
              setText(t);
              onTyping?.();
            }}
            placeholder="Type a message..."
            placeholderTextColor={colors.gray400}
            multiline
            maxLength={CONFIG.MAX_MESSAGE_LENGTH}
          />
          <TouchableOpacity
            style={[styles.sendButton, !text.trim() && styles.sendDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
            activeOpacity={0.7}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    paddingBottom: 0,
    backgroundColor: colors.gray50,
  },
  replyPreviewContent: { flex: 1, marginLeft: spacing.xs },
  replyPreviewLabel: { ...typography.small, color: colors.primary, fontWeight: '600' },
  replyPreviewText: { ...typography.caption, color: colors.textSecondary },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  attachIcon: { fontSize: 22, color: colors.primary, fontWeight: '700' },
  input: {
    flex: 1,
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 100,
    marginRight: spacing.sm,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendIcon: { fontSize: 18, color: colors.white, fontWeight: '700' },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  cancelRecordButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.error,
  },
  recordingTime: {
    ...typography.body,
    color: colors.error,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  recordingSpacer: { flex: 1 },
  stopRecordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.button,
  },
  stopRecordText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '600',
  },
});
