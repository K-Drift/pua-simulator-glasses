package com.example.rokidaudiodemo;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.drawable.Animatable;
import android.graphics.drawable.Drawable;
import android.util.Base64;
import android.util.Log;
import android.util.Size;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.ss.bytertc.engine.IAudioSource;
import com.ss.bytertc.engine.RTCEngine;
import com.ss.bytertc.engine.RTCRoom;
import com.ss.bytertc.engine.RTCRoomConfig;
import com.ss.bytertc.engine.UserInfo;
import com.ss.bytertc.engine.data.AudioChannel;
import com.ss.bytertc.engine.data.AudioRenderType;
import com.ss.bytertc.engine.data.AudioSampleRate;
import com.ss.bytertc.engine.data.AudioSourceType;
import com.ss.bytertc.engine.data.EngineConfig;
import com.ss.bytertc.engine.data.LocalAudioStreamError;
import com.ss.bytertc.engine.data.LocalAudioStreamState;
import com.ss.bytertc.engine.data.RemoteAudioState;
import com.ss.bytertc.engine.data.RemoteAudioStateChangeReason;
import com.ss.bytertc.engine.data.StreamInfo;
import com.ss.bytertc.engine.handler.IRTCEngineEventHandler;
import com.ss.bytertc.engine.handler.IRTCRoomEventHandler;
import com.ss.bytertc.engine.type.AudioProfileType;
import com.ss.bytertc.engine.type.AudioScenarioType;
import com.ss.bytertc.engine.type.ChannelProfile;
import com.ss.bytertc.engine.type.RoomState;
import com.ss.bytertc.engine.type.RoomStateChangeReason;
import com.ss.bytertc.engine.type.SubtitleErrorCode;
import com.ss.bytertc.engine.type.SubtitleMessage;
import com.ss.bytertc.engine.type.SubtitleState;
import com.ss.bytertc.engine.utils.AudioFrame;

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends ComponentActivity {
    private static final String TAG = "RokidRecordDemo";
    private static final int BARE_BG = 0xFF000000;
    private static final int BARE_GREEN = 0xFF00FF00;
    private static final int PERMISSION_REQUEST = 1001;
    private static final int SAMPLE_RATE = 16000;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    private static final int BUFFER_SIZE = 1024;
    private static final int AUDIO_CHANNEL = 0x6000fc;
    private static final int RTC_TAIL_SILENCE_MS = 1200;
    private static final int RTC_CLEANUP_DELAY_MS = 45000;
    private static final Size PHOTO_TARGET_RESOLUTION = new Size(960, 540);
    private static final int PHOTO_JPEG_QUALITY = 100;
    // 后端地址与 TTS 密钥由 BuildConfig 注入（值来自 gradle 属性 / 环境变量，见 README「配置与密钥」）
    private static final String BACKEND_BASE_URL = BuildConfig.BACKEND_BASE_URL;
    private static final String PHOTO_UPLOAD_CATEGORY = "rokid";
    private static final String GLASSES_DEVICE_ID = "rokid-glasses-001";
    private static final String WIFI_SSID = "IF.Land Hackathon";
    private static final String TTS_URL = "https://openspeech.bytedance.com/api/v1/tts";
    private static final String TTS_API_KEY = BuildConfig.TTS_API_KEY;
    private static final String TTS_CLUSTER = "volcano_icl";
    private static final String TTS_VOICE_TYPE = "S_OoL68Oa42";
    private static final int STREAM_TTS_COMPAT = 9;
    private static final int STREAM_ASSISTANT_COMPAT = 11;
    private static final long AUTO_PHOTO_INTERVAL_MS = 10_000L;
    private static final long AUTO_PHOTO_START_DELAY_MS = 1_000L;
    private static final long RTC_CAMERA_RESUME_DELAY_MS = 10_000L;
    private static final long STATUS_RECONNECT_DELAY_MS = 2_000L;
    private static final long STATUS_RECONNECT_MAX_DELAY_MS = 15_000L;
    private static final long WIFI_RECOVERY_INTERVAL_MS = 5_000L;
    private static final long WIFI_RECONNECT_MIN_INTERVAL_MS = 30_000L;
    private static final int RTC_SUBTITLE_HEADER_SIZE = 8;
    private static final String RTC_EXIT_SUBTITLE_MARKER = "[[RTC_EXIT]]";
    private static final String RTC_EXIT_SUBTITLE_KEYWORD = "结束";
    private static final long RTC_EXIT_MARKER_DELAY_MS = 300L;
    private static final long RTC_EXIT_KEYWORD_DELAY_MS = 2_500L;
    private static final String TAKE_STATUS_CHANGED_ACTION = "com.rokid.sprite.ACTION_TAKE_STATUS_CHANGED";
    private static final String LEG_STATUS_CHANGED_ACTION = "com.rokid.sprite.ACTION_LEG_STATUS_CHANGED";
    private static final String TAKE_STATE_EXTRA = "glasses_take_state";
    private static final String TAKE_STATE_WORN = "1";
    private static final String TAKE_STATE_OFF = "0";
    private static final String TAKE_STATE_PROPERTY = "vendor.rkd.glasses.is_take_on";
    private static final String LEG_SPREAD_PROPERTY = "vendor.rkd.glasses.is_spread";

    private static final String[] ROKID_KEY_ACTIONS = {
            TAKE_STATUS_CHANGED_ACTION,
            LEG_STATUS_CHANGED_ACTION,
            "com.android.action.ACTION_SPRITE_BUTTON_CLICK",
            "com.android.action.ACTION_SPRITE_BUTTON_DOWN",
            "com.android.action.ACTION_SPRITE_BUTTON_UP",
            "com.android.action.ACTION_SPRITE_BUTTON_DOUBLE_CLICK",
            "com.android.action.ACTION_AI_START",
            "com.android.action.ACTION_SPRITE_BUTTON_LONG_PRESS",
            "com.android.action.ACTION_TWO_FINGER_SINGLE_TAP",
            "com.android.action.ACTION_TWO_FINGER_DOUBLE_TAP",
            "com.android.action.ACTION_TWO_FINGER_SWIPE_FORWARD",
            "com.android.action.ACTION_TWO_FINGER_SWIPE_BACK",
            "com.android.action.ACTION_SETTINGS_KEY",
            "com.rokid.intent.action.CLICK",
            "com.rokid.intent.action.BUTTON_DOWN",
            "com.rokid.intent.action.BUTTON_UP",
            "com.rokid.intent.action.DOUBLE_CLICK",
            "com.rokid.intent.action.AI_START",
            "com.rokid.intent.action.LONG_PRESS",
            "com.rokid.action.CLICK",
            "com.rokid.action.BUTTON_DOWN",
            "com.rokid.action.BUTTON_UP",
            "com.rokid.action.DOUBLE_CLICK",
            "com.rokid.action.AI_START",
            "com.rokid.action.LONG_PRESS",
            "com.rokid.glass.key.CLICK",
            "com.rokid.glass.key.BUTTON_DOWN",
            "com.rokid.glass.key.BUTTON_UP",
            "android.intent.action.MEDIA_BUTTON"
    };

    private TextView statusView;
    private TextView detailView;
    private TextView pathView;
    private TextView latestStateView;
    private TextView cameraStatusView;
    private TextView photoPathView;
    private Button bossTalkButton;
    private LinearLayout bossTtsOverlay;
    private LinearLayout userRtcSubtitleRow;
    private ImageView bossTtsAvatarView;
    private ImageView userRtcAvatarView;
    private TextView bossTtsSubtitleView;
    private TextView userRtcSubtitleView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object recordLock = new Object();
    private final Object rtcLock = new Object();
    private final Object ttsLock = new Object();

    private volatile boolean isRecordingActive;
    private volatile boolean isStartingSession;
    private volatile boolean isRtcSessionActive;
    private volatile String currentTtsVoiceType = TTS_VOICE_TYPE;
    private volatile String pendingRtcScenario = "";
    private AudioRecord recorder;
    private Thread recordingThread;
    private File currentRecordingFile;
    private String currentRecordMode = "";
    private long currentRecordingBytes;

    private RTCEngine rtcEngine;
    private RTCRoom rtcRoom;
    private RtcSessionInfo currentRtcSession;
    private ExternalAudioPusher audioPusher;
    private Runnable pendingRtcCleanup;
    private volatile boolean rtcRoomJoined;
    private volatile String currentRtcAgentUserId = "rokid-ai-bot-001";
    private volatile String latestBossRtcSubtitle = "";
    private volatile String latestUserRtcSubtitle = "";
    private volatile String latestBinarySubtitlePayload = "";
    private volatile boolean rtcExitMarkerHandled;

    private ExecutorService cameraExecutor;
    private ExecutorService photoUploadExecutor;
    private ExecutorService statusPollExecutor;
    private ExecutorService ttsExecutor;
    private MediaPlayer ttsPlayer;
    private ConnectivityManager connectivityManager;
    private WifiManager wifiManager;
    private ProcessCameraProvider cameraProvider;
    private ImageCapture imageCapture;
    private volatile boolean isCameraReady;
    private volatile boolean isCameraUploadEnabled;
    private volatile boolean cameraConfigLoaded;
    private volatile boolean cameraConfigInFlight;
    private volatile boolean isTakingPhoto;
    private volatile boolean isPhotoUploadInFlight;
    private volatile boolean takePhotoAfterCameraBind;
    private volatile String takePhotoAfterCameraBindSource = "";
    private volatile boolean isAutoPhotoPausedForTts;
    private volatile boolean isAutoPhotoPausedForRtc;
    private volatile boolean autoPhotoLoopEnabled;
    private Runnable autoPhotoRunnable;
    private Runnable rtcCameraResumeRunnable;
    private int uploadedPhotoCount;
    private volatile boolean statusPollingEnabled;
    private volatile boolean statusPollInFlight;
    private Runnable statusPollRunnable;
    private Runnable wifiRecoveryRunnable;
    private volatile boolean isWorn = false;
    private volatile boolean takeStatusRefreshInFlight;
    private volatile long manualStatusOverrideUntilMs;
    private long lastWifiReconnectAt;

    private final BroadcastReceiver keyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent == null ? "" : String.valueOf(intent.getAction());
            Log.d(TAG, "key broadcast: " + action);
            if (TAKE_STATUS_CHANGED_ACTION.equals(action)) {
                Log.d(TAG, "take broadcast extras: " + intentExtrasToLog(intent));
                handleTakeStatusChanged(intent.getStringExtra(TAKE_STATE_EXTRA));
                if (isOrderedBroadcast()) {
                    abortBroadcast();
                }
                return;
            }
            if (LEG_STATUS_CHANGED_ACTION.equals(action)) {
                Log.d(TAG, "leg broadcast extras: " + intentExtrasToLog(intent));
                requestTakeStatusRefresh("leg-broadcast");
                if (isOrderedBroadcast()) {
                    abortBroadcast();
                }
                return;
            }

            if (isLongPressAction(action)) {
                exitApplicationFromLongPress("broadcast:" + action);
            } else if (action.contains("BUTTON_DOWN")) {
                showDetail("系统按键按下: " + action);
            } else if (action.contains("BUTTON_UP")) {
                showDetail("系统按键抬起: " + action);
            } else if (action.contains("CLICK") && !action.contains("DOUBLE_CLICK") && !action.contains("DOUBLE_TAP")
                    || Intent.ACTION_MEDIA_BUTTON.equals(action)) {
                toggleRecording("broadcast:" + action);
            } else {
                showDetail("系统按键已拦截: " + action);
            }

            if (isOrderedBroadcast()) {
                abortBroadcast();
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterBareFullscreen();
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        cameraExecutor = Executors.newSingleThreadExecutor();
        photoUploadExecutor = Executors.newSingleThreadExecutor();
        statusPollExecutor = Executors.newSingleThreadExecutor();
        ttsExecutor = Executors.newSingleThreadExecutor();
        setContentView(createContentView());
        registerKeyReceiver();
        requestInitialTakeStatus("startup");
        startWifiRecoveryLoop();
        startStatusPolling();
        if (hasRuntimePermissions()) {
            showIdle();
            requestCameraConfig("startup");
        } else {
            statusView.setText(R.string.record_permission);
            requestRuntimePermissions();
        }
    }

    private void enterBareFullscreen() {
        getWindow().setStatusBarColor(BARE_BG);
        getWindow().setNavigationBarColor(BARE_BG);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    protected void onDestroy() {
        stopRecording("destroy");
        stopWifiRecoveryLoop();
        stopStatusPolling();
        stopAutoPhotoLoop();
        cancelDelayedRtcCameraResume();
        stopTtsPlayback("destroy");
        releaseRtcSession("destroy", true);
        unbindCamera();
        if (cameraExecutor != null) {
            cameraExecutor.shutdown();
        }
        if (photoUploadExecutor != null) {
            photoUploadExecutor.shutdown();
        }
        if (statusPollExecutor != null) {
            statusPollExecutor.shutdown();
        }
        if (ttsExecutor != null) {
            ttsExecutor.shutdown();
        }
        unregisterReceiver(keyReceiver);
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        showDetail("KeyDown: " + KeyEvent.keyCodeToString(keyCode) + " (" + keyCode + ")");
        if (event != null && event.isLongPress()) {
            exitApplicationFromLongPress("key-long:" + KeyEvent.keyCodeToString(keyCode));
            return true;
        }
        if (event != null && event.getRepeatCount() > 0) {
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            showDetail("返回键已拦截");
            return true;
        }
        if (isPhotoKey(keyCode)) {
            takePhoto("key:" + KeyEvent.keyCodeToString(keyCode));
            return true;
        }
        if (isToggleKey(keyCode) && getCurrentFocus() == bossTalkButton) {
            toggleBossTalk("key-focus:" + KeyEvent.keyCodeToString(keyCode));
            return true;
        }
        if (isToggleKey(keyCode)) {
            toggleRecording("key:" + KeyEvent.keyCodeToString(keyCode));
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            showDetail("返回键抬起，已拦截");
            return true;
        }
        if (isPhotoKey(keyCode) || isToggleKey(keyCode)) {
            showDetail("KeyUp: " + KeyEvent.keyCodeToString(keyCode) + " (" + keyCode + ")");
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        showDetail("系统返回已拦截");
    }

    private boolean isLongPressAction(String action) {
        return action != null && action.contains("LONG_PRESS");
    }

    private void exitApplicationFromLongPress(String source) {
        Log.d(TAG, "exitApplicationFromLongPress: " + source);
        statusView.setText("长按退出应用");
        showDetail("长按退出: " + source);
        stopStatusPolling();
        stopAutoPhotoLoop();
        cancelDelayedRtcCameraResume();
        if (isRecordingActive || recorder != null) {
            stopRecording(source, false);
        }
        isStartingSession = false;
        releaseRtcSession(source, true);
        finishAndRemoveTask();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PERMISSION_REQUEST) {
            return;
        }

        if (hasRuntimePermissions()) {
            showIdle();
            requestCameraConfig("permissions");
        } else {
            statusView.setText(R.string.record_permission);
            showDetail("可用 adb 授权 CAMERA / RECORD_AUDIO / WRITE_EXTERNAL_STORAGE");
        }
    }

    private FrameLayout createContentView() {
        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(BARE_BG);

        statusView = new TextView(this);
        statusView.setText(R.string.record_idle);

        detailView = new TextView(this);
        detailView.setText("16kHz / PCM16 / AUDIO_CHANNEL=0x" + Integer.toHexString(AUDIO_CHANNEL));

        pathView = new TextView(this);
        pathView.setText("/sdcard/Audio/");

        cameraStatusView = new TextView(this);
        cameraStatusView.setText(R.string.camera_preparing);

        photoPathView = new TextView(this);
        photoPathView.setText("/sdcard/Pictures/bare_photo/");

        root.addView(createTopRightStatusLabel());
        root.addView(createBossTtsOverlay());
        root.addView(createBottomRightActionPanel());
        return root;
    }

    private TextView createTopRightStatusLabel() {
        latestStateView = new TextView(this);
        latestStateView.setText("当前状态\n等待后端");
        latestStateView.setTextSize(12);
        latestStateView.setGravity(Gravity.RIGHT);
        latestStateView.setTextColor(BARE_GREEN);
        latestStateView.setIncludeFontPadding(false);
        latestStateView.setPadding(dp(4), dp(4), dp(4), dp(4));
        latestStateView.setBackgroundColor(Color.TRANSPARENT);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                dp(150),
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.RIGHT);
        params.setMargins(0, dp(10), dp(10), 0);
        latestStateView.setLayoutParams(params);
        return latestStateView;
    }

    private LinearLayout createBossTtsOverlay() {
        bossTtsOverlay = new LinearLayout(this);
        bossTtsOverlay.setOrientation(LinearLayout.VERTICAL);
        bossTtsOverlay.setGravity(Gravity.CENTER_HORIZONTAL);
        bossTtsOverlay.setPadding(dp(2), dp(2), dp(2), dp(2));
        bossTtsOverlay.setBackgroundColor(Color.TRANSPARENT);
        bossTtsOverlay.setVisibility(View.GONE);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                dp(270),
                dp(150),
                Gravity.CENTER);
        bossTtsOverlay.setLayoutParams(params);

        LinearLayout bossRow = new LinearLayout(this);
        bossRow.setOrientation(LinearLayout.HORIZONTAL);
        bossRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams bossRowParams = new LinearLayout.LayoutParams(dp(260), dp(64));
        bossTtsOverlay.addView(bossRow, bossRowParams);

        bossTtsAvatarView = new ImageView(this);
        bossTtsAvatarView.setImageResource(R.drawable.mayun_avatar);
        if (bossTtsAvatarView.getDrawable() instanceof Animatable) {
            ((Animatable) bossTtsAvatarView.getDrawable()).start();
        }
        bossTtsAvatarView.setScaleType(ImageView.ScaleType.CENTER_CROP);
        bossTtsAvatarView.setPadding(dp(2), dp(2), dp(2), dp(2));
        bossTtsAvatarView.setBackground(new BareStrokeDrawable(BARE_GREEN, dp(1)));
        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(52), dp(52));
        bossRow.addView(bossTtsAvatarView, avatarParams);

        bossTtsSubtitleView = new TextView(this);
        bossTtsSubtitleView.setText("");
        bossTtsSubtitleView.setTextSize(12);
        bossTtsSubtitleView.setTextColor(BARE_GREEN);
        bossTtsSubtitleView.setGravity(Gravity.CENTER_VERTICAL);
        bossTtsSubtitleView.setIncludeFontPadding(false);
        bossTtsSubtitleView.setPadding(dp(8), dp(6), dp(8), dp(6));
        bossTtsSubtitleView.setBackground(new BareStrokeDrawable(BARE_GREEN, dp(1)));
        bossTtsSubtitleView.setMaxLines(2);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(dp(198), dp(52));
        subtitleParams.setMargins(dp(8), 0, 0, 0);
        bossRow.addView(bossTtsSubtitleView, subtitleParams);

        userRtcSubtitleRow = new LinearLayout(this);
        userRtcSubtitleRow.setOrientation(LinearLayout.HORIZONTAL);
        userRtcSubtitleRow.setGravity(Gravity.CENTER_VERTICAL);
        userRtcSubtitleRow.setVisibility(View.GONE);
        LinearLayout.LayoutParams userRowParams = new LinearLayout.LayoutParams(dp(260), dp(64));
        userRowParams.setMargins(0, dp(10), 0, 0);
        bossTtsOverlay.addView(userRtcSubtitleRow, userRowParams);

        userRtcAvatarView = new ImageView(this);
        userRtcAvatarView.setImageResource(R.drawable.local_test_image);
        userRtcAvatarView.setScaleType(ImageView.ScaleType.CENTER_CROP);
        userRtcAvatarView.setPadding(dp(2), dp(2), dp(2), dp(2));
        userRtcAvatarView.setBackground(new BareStrokeDrawable(BARE_GREEN, dp(1)));
        userRtcSubtitleRow.addView(userRtcAvatarView, new LinearLayout.LayoutParams(dp(52), dp(52)));

        userRtcSubtitleView = new TextView(this);
        userRtcSubtitleView.setText("");
        userRtcSubtitleView.setTextSize(12);
        userRtcSubtitleView.setTextColor(BARE_GREEN);
        userRtcSubtitleView.setGravity(Gravity.CENTER_VERTICAL);
        userRtcSubtitleView.setIncludeFontPadding(false);
        userRtcSubtitleView.setPadding(dp(8), dp(6), dp(8), dp(6));
        userRtcSubtitleView.setBackground(new BareStrokeDrawable(BARE_GREEN, dp(1)));
        userRtcSubtitleView.setMaxLines(2);
        LinearLayout.LayoutParams userSubtitleParams = new LinearLayout.LayoutParams(dp(198), dp(52));
        userSubtitleParams.setMargins(dp(8), 0, 0, 0);
        userRtcSubtitleRow.addView(userRtcSubtitleView, userSubtitleParams);
        return bossTtsOverlay;
    }

    private LinearLayout createBottomRightActionPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setBackgroundColor(Color.TRANSPARENT);
        int margin = dp(10);
        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.RIGHT);
        panelParams.setMargins(margin, margin, margin, margin);
        panel.setLayoutParams(panelParams);

        bossTalkButton = new Button(this);
        bossTalkButton.setText("点击按钮 找老板谈话");
        bossTalkButton.setTextSize(12);
        bossTalkButton.setTextColor(BARE_GREEN);
        bossTalkButton.setAllCaps(false);
        bossTalkButton.setMinWidth(0);
        bossTalkButton.setMinHeight(0);
        bossTalkButton.setPadding(dp(6), 0, dp(6), 0);
        bossTalkButton.setBackground(new BareStrokeDrawable(BARE_GREEN, dp(1)));
        bossTalkButton.setStateListAnimator(null);
        bossTalkButton.setFocusable(true);
        bossTalkButton.setFocusableInTouchMode(true);
        bossTalkButton.setOnClickListener(v -> toggleBossTalk("button"));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(dp(160), dp(34));
        panel.addView(bossTalkButton, buttonParams);
        bossTalkButton.requestFocus();
        return panel;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterBareFullscreen();
        }
    }

    private static final class BareStrokeDrawable extends Drawable {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final float strokeWidth;

        BareStrokeDrawable(int color, float strokeWidth) {
            this.strokeWidth = Math.max(1f, strokeWidth);
            paint.setColor(color);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(this.strokeWidth);
        }

        @Override
        public void draw(Canvas canvas) {
            RectF bounds = new RectF(getBounds());
            float inset = strokeWidth / 2f;
            bounds.inset(inset, inset);
            canvas.drawRect(bounds, paint);

            float tick = Math.min(bounds.width(), bounds.height()) * 0.18f;
            canvas.drawLine(bounds.left, bounds.top + tick, bounds.left, bounds.top, paint);
            canvas.drawLine(bounds.left, bounds.top, bounds.left + tick, bounds.top, paint);
            canvas.drawLine(bounds.right - tick, bounds.bottom, bounds.right, bounds.bottom, paint);
            canvas.drawLine(bounds.right, bounds.bottom - tick, bounds.right, bounds.bottom, paint);
            canvas.drawCircle(bounds.right - tick, bounds.top + tick, Math.max(1f, strokeWidth * 1.5f), paint);
        }

        @Override
        public void setAlpha(int alpha) {
            paint.setAlpha(alpha);
            invalidateSelf();
        }

        @Override
        public void setColorFilter(android.graphics.ColorFilter colorFilter) {
            paint.setColorFilter(colorFilter);
            invalidateSelf();
        }

        @Override
        public int getOpacity() {
            return PixelFormat.TRANSLUCENT;
        }
    }

    private void registerKeyReceiver() {
        IntentFilter filter = new IntentFilter();
        for (String action : ROKID_KEY_ACTIONS) {
            filter.addAction(action);
        }
        filter.setPriority(100);
        Intent sticky = registerReceiver(keyReceiver, filter);
        if (sticky != null && TAKE_STATUS_CHANGED_ACTION.equals(sticky.getAction())) {
            handleTakeStatusChanged(sticky.getStringExtra(TAKE_STATE_EXTRA));
        } else if (sticky != null && LEG_STATUS_CHANGED_ACTION.equals(sticky.getAction())) {
            requestTakeStatusRefresh("leg-sticky");
        }
    }

    private void requestInitialTakeStatus(String source) {
        requestTakeStatusRefresh(source);
    }

    private void requestTakeStatusRefresh(String source) {
        if (takeStatusRefreshInFlight) {
            return;
        }
        takeStatusRefreshInFlight = true;
        new Thread(() -> {
            try {
                String takeState = readSystemProperty(TAKE_STATE_PROPERTY);
                String spreadState = readSystemProperty(LEG_SPREAD_PROPERTY);
                Log.d(TAG, "take status refresh: source=" + source
                        + " " + TAKE_STATE_PROPERTY + "=" + takeState
                        + " " + LEG_SPREAD_PROPERTY + "=" + spreadState);
                runOnUiThread(() -> applyTakeStatusFromSystem(takeState, spreadState, source));
            } finally {
                takeStatusRefreshInFlight = false;
            }
        }, "RokidTakeStatus").start();
    }

    private void applyTakeStatusFromSystem(String takeState, String spreadState, String source) {
        if (TAKE_STATE_OFF.equals(spreadState)) {
            handleTakeOff();
            showDetail("折叠状态: 已折叠，关闭摄像头 / " + source);
            return;
        }
        if (TAKE_STATE_WORN.equals(takeState)) {
            handleWorn();
        } else if (TAKE_STATE_OFF.equals(takeState)) {
            handleTakeOff();
        } else {
            handleTakeOff();
            showDetail("佩戴状态未知，默认关闭摄像头: " + source
                    + " / take=" + takeState + " spread=" + spreadState);
        }
    }

    private String intentExtrasToLog(Intent intent) {
        if (intent == null || intent.getExtras() == null || intent.getExtras().isEmpty()) {
            return "{}";
        }
        StringBuilder builder = new StringBuilder("{");
        for (String key : intent.getExtras().keySet()) {
            if (builder.length() > 1) {
                builder.append(", ");
            }
            Object value = intent.getExtras().get(key);
            builder.append(key).append("=").append(value);
        }
        return builder.append("}").toString();
    }

    private static String readSystemProperty(String key) {
        String value = readSystemPropertyByReflection(key);
        if (!value.isEmpty()) {
            return value;
        }
        return readSystemPropertyByGetprop(key);
    }

    private static String readSystemPropertyByReflection(String key) {
        try {
            Class<?> systemProperties = Class.forName("android.os.SystemProperties");
            Object value = systemProperties
                    .getMethod("get", String.class, String.class)
                    .invoke(null, key, "");
            return value == null ? "" : String.valueOf(value).trim();
        } catch (Exception e) {
            Log.w(TAG, "read system property by reflection failed: " + key, e);
            return "";
        }
    }

    private static String readSystemPropertyByGetprop(String key) {
        Process process = null;
        try {
            process = Runtime.getRuntime().exec(new String[]{"getprop", key});
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line = reader.readLine();
                return line == null ? "" : line.trim();
            }
        } catch (Exception e) {
            Log.w(TAG, "read system property by getprop failed: " + key, e);
            return "";
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private boolean hasRuntimePermissions() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestRuntimePermissions() {
        requestPermissions(new String[]{
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA,
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
        }, PERMISSION_REQUEST);
    }

    private boolean isPhotoKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_CAMERA
                || keyCode == KeyEvent.KEYCODE_FOCUS;
    }

    private boolean isToggleKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_ASSIST
                || keyCode == KeyEvent.KEYCODE_HEADSETHOOK
                || keyCode == KeyEvent.KEYCODE_MEDIA_RECORD
                || keyCode == KeyEvent.KEYCODE_BUTTON_A
                || keyCode == KeyEvent.KEYCODE_BUTTON_START
                || keyCode == KeyEvent.KEYCODE_STEM_PRIMARY
                || keyCode == KeyEvent.KEYCODE_STEM_1;
    }

    private void updateBossTalkButton(boolean inTalk) {
        if (bossTalkButton != null) {
            bossTalkButton.setText(inTalk ? "点击按钮 退出谈话" : "点击按钮 找老板谈话");
        }
    }

    private void toggleBossTalk(String source) {
        boolean shouldExit;
        synchronized (recordLock) {
            shouldExit = isStartingSession || isRecordingActive || isRtcSessionActive || currentRtcSession != null;
        }
        if (shouldExit) {
            stopBossTalk(source);
        } else {
            startBossTalk(source);
        }
    }

    private void startBossTalk(String source) {
        startBossTalk(source, "kpi_fix");
    }

    private void startBossTalk(String source, String scenario) {
        if (!isWorn) {
            statusView.setText("摘下状态，老板谈话暂停");
            showDetail("佩戴后再开始 RTC 语音");
            return;
        }
        if (!hasRuntimePermissions()) {
            statusView.setText(R.string.record_permission);
            showDetail("找老板谈话需要录音权限: " + source);
            requestRuntimePermissions();
            return;
        }

        synchronized (recordLock) {
            pendingRtcScenario = normalizeRtcScenario(scenario);
            if (isStartingSession) {
                statusView.setText("正在进入老板谈话");
                updateBossTalkButton(true);
                showDetail("RTC 正在连接，请稍等: " + source);
            } else if (isRecordingActive || isRtcSessionActive) {
                statusView.setText("老板谈话中");
                updateBossTalkButton(true);
                showDetail("RTC 会话已在进行: " + source);
            } else {
                statusView.setText("找老板谈话");
                updateBossTalkButton(true);
                showDetail("正在进入 RTC: " + source);
                startRecording("boss-talk:" + source);
            }
        }
    }

    private void startOnboardingTraining(String source) {
        if (isRtcBusy()) {
            statusView.setText("老板谈话中");
            updateBossTalkButton(true);
            showDetail("RTC 已在进行，忽略重复入职培训命令: " + source);
            return;
        }
        synchronized (recordLock) {
            pendingRtcScenario = "onboarding";
        }
        if (!isRtcBusy()) {
            startBossTalk(source, "onboarding");
        }
    }

    private String normalizeRtcScenario(String scenario) {
        String safeScenario = scenario == null ? "" : scenario.trim().toLowerCase(Locale.US);
        if ("onboarding".equals(safeScenario)
                || "onboarding_training".equals(safeScenario)
                || "entry_training".equals(safeScenario)) {
            return "onboarding";
        }
        if ("kpi_fix".equals(safeScenario)
                || "kpi-fix".equals(safeScenario)
                || "boss_fix".equals(safeScenario)
                || "boss_talk".equals(safeScenario)) {
            return "kpi_fix";
        }
        return "";
    }

    private void stopBossTalk(String source) {
        statusView.setText("退出谈话中");
        showDetail("正在退出 RTC: " + source);
        cancelPendingRtcCleanup();
        if (isRecordingActive || recorder != null) {
            stopRecording("boss-talk-exit:" + source, false);
        } else {
            synchronized (recordLock) {
                isStartingSession = false;
            }
        }
        releaseRtcSession("boss-talk-exit:" + source, true);
        pendingRtcScenario = "";
        resumeAutoPhotoAfterRtc("boss-talk-exit:" + source);
        updateBossTalkButton(false);
        statusView.setText("已退出谈话");
        showDetail("已退出 RTC: " + source);
    }

    private void toggleRecording(String source) {
        if (!isWorn) {
            statusView.setText("摘下状态，语音已暂停");
            showDetail("佩戴后再开始 RTC 语音");
            return;
        }
        if (!hasRuntimePermissions()) {
            statusView.setText(R.string.record_permission);
            showDetail("触发源: " + source);
            requestRuntimePermissions();
            return;
        }

        synchronized (recordLock) {
            if (isStartingSession) {
                showDetail("正在连接 RTC 和 AI，请稍等");
            } else if (isRecordingActive) {
                stopRecording(source);
            } else if (isRtcSessionActive) {
                releaseRtcSession(source, true);
                resumeAutoPhotoAfterRtc("manual-exit:" + source);
                showIdle();
            } else {
                startRecording(source);
            }
        }
    }

    private void startRecording(String source) {
        stopTtsPlayback("rtc-start");
        pauseAutoPhotoForRtc("rtc-start:" + source);
        isStartingSession = true;
        cancelPendingRtcCleanup();
        statusView.setText(R.string.rtc_connecting);
        showDetail("请求后端拉起 AI: " + source);
        pathView.setText(BACKEND_BASE_URL);
        String rtcScenario = normalizeRtcScenario(pendingRtcScenario);

        new Thread(() -> {
            try {
                RtcSessionInfo session = requestRtcSession(rtcScenario);
                runOnUiThread(() -> beginRecordingWithSession(source, session));
            } catch (Exception e) {
                Log.e(TAG, "requestRtcSession failed", e);
                runOnUiThread(() -> {
                    isStartingSession = false;
                    updateBossTalkButton(false);
                    statusView.setText(R.string.record_failed);
                    showDetail("RTC session 请求失败: " + e.getMessage());
                    resumeAutoPhotoAfterRtc("rtc-session-failed:" + source);
                });
            }
        }, "RokidRtcSession").start();
    }

    private void beginRecordingWithSession(String source, RtcSessionInfo session) {
        if (!isStartingSession) {
            currentRtcSession = session;
            releaseRtcSession("start-cancelled", true);
            resumeAutoPhotoAfterRtc("start-cancelled:" + source);
            updateBossTalkButton(false);
            statusView.setText("已退出谈话");
            showDetail("RTC 启动已取消: " + source);
            return;
        }
        currentRtcSession = session;
        currentRtcAgentUserId = session.agentUserId == null || session.agentUserId.isEmpty()
                ? "rokid-ai-bot-001"
                : session.agentUserId;
        latestBossRtcSubtitle = "";
        latestUserRtcSubtitle = "";
        latestBinarySubtitlePayload = "";
        rtcExitMarkerHandled = false;
        if (!isWorn) {
            isStartingSession = false;
            releaseRtcSession("take-off-before-record", true);
            updateBossTalkButton(false);
            statusView.setText("摘下，已退出 AI 会话");
            showDetail("佩戴后再开始 RTC 语音");
            return;
        }
        try {
            setupRtcSession(session);
        } catch (Exception e) {
            Log.e(TAG, "setupRtcSession failed", e);
            isStartingSession = false;
            releaseRtcSession("setup-failed", true);
            resumeAutoPhotoAfterRtc("setup-failed:" + source);
            updateBossTalkButton(false);
            statusView.setText(R.string.record_failed);
            showDetail("RTC 初始化失败: " + e.getMessage());
            return;
        }

        currentRecordingFile = createRecordingFile();
        currentRecordingBytes = 0L;
        recorder = createRecorder();
        currentRecordMode = "RTC上传: Rokid算法后ch0/1 -> mono 16k PCM";

        if (recorder == null || currentRecordingFile == null) {
            isStartingSession = false;
            releaseRtcSession("record-init-failed", true);
            failRecording("AudioRecord 初始化失败");
            return;
        }

        try {
            recorder.startRecording();
        } catch (Exception e) {
            Log.e(TAG, "startRecording failed", e);
            isStartingSession = false;
            releaseRtcSession("start-failed", true);
            failRecording("startRecording 失败: " + e.getMessage());
            return;
        }

        if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
            isStartingSession = false;
            releaseRtcSession("record-state-failed", true);
            failRecording("AudioRecord 未进入 RECORDING 状态");
            return;
        }

        isRecordingActive = true;
        isStartingSession = false;
        isRtcSessionActive = true;
        updateBossTalkButton(true);
        AudioRecord activeRecorder = recorder;
        File activeFile = currentRecordingFile;
        recordingThread = new Thread(() -> writeAudioDataToFile(activeRecorder, activeFile), "RokidAudioRecord");
        recordingThread.start();

        statusView.setText(R.string.recording);
        pathView.setText(activeFile.getAbsolutePath());
        showRtcSubtitlePlaceholder();
        showDetail(currentRecordMode + " / room=" + session.roomId);
    }

    private void setupRtcSession(RtcSessionInfo session) throws Exception {
        synchronized (rtcLock) {
            releaseRtcSessionLocked(false);

            EngineConfig engineConfig = new EngineConfig();
            engineConfig.context = getApplicationContext();
            engineConfig.appID = session.appId;
            rtcEngine = RTCEngine.createRTCEngine(engineConfig, new IRTCEngineEventHandler() {
                @Override
                public void onError(int errorCode) {
                    Log.e(TAG, "RTC engine error: " + errorCode);
                    runOnUiThread(() -> showDetail("RTC error=" + errorCode));
                }

                @Override
                public void onWarning(int warningCode) {
                    Log.w(TAG, "RTC engine warning: " + warningCode);
                }

                @Override
                public void onLocalAudioStateChanged(IAudioSource source,
                                                     LocalAudioStreamState state,
                                                     LocalAudioStreamError error) {
                    Log.d(TAG, "local audio state=" + state + " error=" + error);
                }

                @Override
                public void onRemoteAudioStateChanged(String roomId,
                                                      StreamInfo streamInfo,
                                                      RemoteAudioState state,
                                                      RemoteAudioStateChangeReason reason) {
                    Log.d(TAG, "remote audio state room=" + roomId + " state=" + state + " reason=" + reason);
                }

                @Override
                public void onFirstRemoteAudioFrame(String roomId, StreamInfo streamInfo) {
                    Log.d(TAG, "first remote audio frame: " + roomId);
                    runOnUiThread(() -> {
                        statusView.setText(R.string.ai_playing);
                        showDetail("收到 AI 音频，RTC 正在播放");
                    });
                }
            });

            if (rtcEngine == null) {
                throw new IllegalStateException("RTCEngine.createRTCEngine returned null");
            }

            rtcEngine.setAudioScenario(AudioScenarioType.AICLIENT);
            rtcEngine.setAudioProfile(AudioProfileType.AUDIO_PROFILE_STANDARD);
            rtcEngine.setAudioSourceType(AudioSourceType.AUDIO_SOURCE_TYPE_EXTERNAL);
            rtcEngine.setAudioRenderType(AudioRenderType.AUDIO_RENDER_TYPE_INTERNAL);
            rtcEngine.setPlaybackVolume(100);

            rtcRoom = rtcEngine.createRTCRoom(session.roomId);
            if (rtcRoom == null) {
                throw new IllegalStateException("createRTCRoom returned null");
            }
            rtcRoom.setRTCRoomEventHandler(new IRTCRoomEventHandler() {
                @Override
                public void onRoomStateChangedWithReason(String roomId,
                                                         String uid,
                                                         RoomState state,
                                                         RoomStateChangeReason reason) {
                    Log.d(TAG, "room state room=" + roomId + " uid=" + uid + " state=" + state + " reason=" + reason);
                    if (state == RoomState.JOIN_SUCCESS) {
                        rtcRoomJoined = true;
                        ExternalAudioPusher pusher = audioPusher;
                        if (pusher != null) {
                            pusher.setReady(true);
                        }
                    }
                    runOnUiThread(() -> showDetail("RTC房间: " + state + " / " + reason));
                }

                @Override
                public void onRoomStateChanged(String roomId, String uid, int state, String extraInfo) {
                    Log.d(TAG, "room state raw room=" + roomId + " uid=" + uid + " state=" + state + " extra=" + extraInfo);
                }

                @Override
                public void onUserJoined(UserInfo userInfo) {
                    String uid = userInfo == null ? "" : userInfo.getUid();
                    Log.d(TAG, "room user joined: " + uid);
                    runOnUiThread(() -> showDetail("远端加入: " + uid));
                }

                @Override
                public void onUserPublishStreamAudio(String uid, StreamInfo streamInfo, boolean isScreen) {
                    Log.d(TAG, "remote publish audio: " + uid);
                    runOnUiThread(() -> showDetail("AI 音频流已发布: " + uid));
                }

                @Override
                public void onSubtitleStateChanged(SubtitleState state,
                                                   SubtitleErrorCode errorCode,
                                                   String errorMessage) {
                    Log.d(TAG, "subtitle state=" + state + " error=" + errorCode + " message=" + errorMessage);
                    runOnUiThread(() -> showDetail("字幕状态: " + state + " / " + errorCode));
                }

                @Override
                public void onSubtitleMessageReceived(SubtitleMessage[] messages) {
                    if (messages == null) {
                        return;
                    }
                    for (SubtitleMessage message : messages) {
                        if (message == null || message.text == null || message.text.trim().isEmpty()) {
                            continue;
                        }
                        String uid = message.userId == null ? "" : message.userId;
                        String text = message.text.trim();
                        Log.d(TAG, "subtitle message uid=" + uid + " seq=" + message.sequence
                                + " definite=" + message.definite + " text=" + text);
                        boolean definite = message.definite;
                        runOnUiThread(() -> updateRtcSubtitle(uid, text, definite, false, "subtitle"));
                    }
                }

                @Override
                public void onRoomMessageReceived(String uid, String message) {
                    Log.d(TAG, "room message uid=" + uid + " message=" + message);
                    handleRtcTextMessage(uid, message, "room-message");
                }

                @Override
                public void onRoomBinaryMessageReceived(String uid, ByteBuffer message) {
                    Log.d(TAG, "room binary message uid=" + uid
                            + " bytes=" + (message == null ? 0 : message.remaining()));
                    handleRtcBinarySubtitleMessage(uid, message, "room-binary");
                }

                @Override
                public void onUserMessageReceived(String uid, String message) {
                    Log.d(TAG, "user message uid=" + uid + " message=" + message);
                    handleRtcTextMessage(uid, message, "user-message");
                }

                @Override
                public void onUserBinaryMessageReceived(String uid, ByteBuffer message) {
                    Log.d(TAG, "user binary message uid=" + uid
                            + " bytes=" + (message == null ? 0 : message.remaining()));
                    handleRtcBinarySubtitleMessage(uid, message, "user-binary");
                }

                @Override
                public void onRoomMessageReceived(long messageId, String uid, String message) {
                    Log.d(TAG, "room message id=" + messageId + " uid=" + uid + " message=" + message);
                    handleRtcTextMessage(uid, message, "room-message-id");
                }

                @Override
                public void onRoomBinaryMessageReceived(long messageId, String uid, ByteBuffer message) {
                    Log.d(TAG, "room binary message id=" + messageId + " uid=" + uid
                            + " bytes=" + (message == null ? 0 : message.remaining()));
                    handleRtcBinarySubtitleMessage(uid, message, "room-binary-id");
                }

                @Override
                public void onUserMessageReceived(long messageId, String uid, String message) {
                    Log.d(TAG, "user message id=" + messageId + " uid=" + uid + " message=" + message);
                    handleRtcTextMessage(uid, message, "user-message-id");
                }

                @Override
                public void onUserBinaryMessageReceived(long messageId, String uid, ByteBuffer message) {
                    Log.d(TAG, "user binary message id=" + messageId + " uid=" + uid
                            + " bytes=" + (message == null ? 0 : message.remaining()));
                    handleRtcBinarySubtitleMessage(uid, message, "user-binary-id");
                }
            });

            RTCRoomConfig roomConfig = new RTCRoomConfig(
                    ChannelProfile.CHANNEL_PROFILE_COMMUNICATION,
                    true,
                    false,
                    true,
                    false
            );
            int joinResult = rtcRoom.joinRoom(session.token, new UserInfo(session.userId, ""), true, roomConfig);
            if (joinResult != 0) {
                throw new IllegalStateException("joinRoom failed: " + joinResult);
            }
            audioPusher = new ExternalAudioPusher(rtcEngine);
        }
    }

    private void bindCameraAsync() {
        if (!isCameraUploadEnabled) {
            showCameraDisabled(cameraConfigLoaded ? "后端配置 cameraEnabled=false" : "等待后端摄像头配置");
            return;
        }
        if (!isWorn) {
            stopAutoPhotoLoop();
            unbindCamera();
            if (cameraStatusView != null) {
                cameraStatusView.setText("摘下: 摄像头已关闭");
            }
            if (photoPathView != null) {
                photoPathView.setText("佩戴后重新绑定摄像头");
            }
            return;
        }
        if (isRtcBusy()) {
            pauseAutoPhotoForRtc("bind-camera");
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            if (cameraStatusView != null) {
                cameraStatusView.setText(R.string.record_permission);
            }
            return;
        }
        if (cameraStatusView != null) {
            cameraStatusView.setText(R.string.camera_preparing);
        }

        ListenableFuture<ProcessCameraProvider> providerFuture = ProcessCameraProvider.getInstance(this);
        providerFuture.addListener(() -> {
            try {
                ProcessCameraProvider provider = providerFuture.get();
                if (!isWorn || !isCameraUploadEnabled || isRtcBusy()) {
                    provider.unbindAll();
                    cameraProvider = null;
                    imageCapture = null;
                    isCameraReady = false;
                    if (!isWorn) {
                        cameraStatusView.setText("摘下: 摄像头已关闭");
                        photoPathView.setText("佩戴后重新绑定摄像头");
                    }
                    Log.d(TAG, "CameraX bind skipped: worn=" + isWorn
                            + " enabled=" + isCameraUploadEnabled + " rtcBusy=" + isRtcBusy());
                    return;
                }
                ImageCapture capture = new ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                        .setTargetResolution(PHOTO_TARGET_RESOLUTION)
                        .setJpegQuality(PHOTO_JPEG_QUALITY)
                        .build();
                provider.unbindAll();
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, capture);
                cameraProvider = provider;
                imageCapture = capture;
                isCameraReady = true;
                cameraStatusView.setText(R.string.camera_ready);
                boolean shouldTakeAfterBind = takePhotoAfterCameraBind;
                String pendingSource = takePhotoAfterCameraBindSource;
                takePhotoAfterCameraBind = false;
                takePhotoAfterCameraBindSource = "";
                if (shouldTakeAfterBind && isWorn && !isRtcBusy() && !isTtsPlaying()) {
                    photoPathView.setText("相机已就绪，准备拍照");
                    mainHandler.postDelayed(
                            () -> takePhoto("camera-bound:" + pendingSource),
                            300L
                    );
                } else if (isWorn && !isRtcBusy() && !isTtsPlaying()) {
                    photoPathView.setText(autoPhotoLabel() + " / category=" + PHOTO_UPLOAD_CATEGORY);
                    startAutoPhotoLoop();
                } else if (isRtcBusy()) {
                    pauseAutoPhotoForRtc("camera-bound");
                } else if (isTtsPlaying()) {
                    isAutoPhotoPausedForTts = true;
                    photoPathView.setText("TTS播报中，暂不恢复拍照");
                } else {
                    photoPathView.setText("摘下: 暂停自动拍照上传");
                }
                Log.d(TAG, "CameraX ImageCapture bound");
            } catch (Exception e) {
                Log.e(TAG, "bindCameraAsync failed", e);
                isCameraReady = false;
                cameraStatusView.setText(R.string.camera_failed);
                photoPathView.setText(e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void startAutoPhotoLoop() {
        startAutoPhotoLoop(AUTO_PHOTO_START_DELAY_MS);
    }

    private void startAutoPhotoLoop(long firstDelayMs) {
        if (!isCameraUploadEnabled) {
            return;
        }
        if (!isWorn) {
            return;
        }
        if (isRtcBusy()) {
            return;
        }
        if (autoPhotoLoopEnabled) {
            return;
        }
        autoPhotoLoopEnabled = true;
        autoPhotoRunnable = new Runnable() {
            @Override
            public void run() {
                if (!autoPhotoLoopEnabled) {
                    return;
                }
                if (isWorn && !isRtcBusy()) {
                    takePhoto("auto-" + (AUTO_PHOTO_INTERVAL_MS / 1000L) + "s");
                }
                mainHandler.postDelayed(this, AUTO_PHOTO_INTERVAL_MS);
            }
        };
        mainHandler.postDelayed(autoPhotoRunnable, Math.max(0L, firstDelayMs));
    }

    private void stopAutoPhotoLoop() {
        autoPhotoLoopEnabled = false;
        if (autoPhotoRunnable != null) {
            mainHandler.removeCallbacks(autoPhotoRunnable);
            autoPhotoRunnable = null;
        }
    }

    private void startWifiRecoveryLoop() {
        if (wifiRecoveryRunnable != null) {
            return;
        }
        wifiRecoveryRunnable = new Runnable() {
            @Override
            public void run() {
                ensureWifiAvailable();
                if (wifiRecoveryRunnable != null) {
                    mainHandler.postDelayed(this, WIFI_RECOVERY_INTERVAL_MS);
                }
            }
        };
        mainHandler.post(wifiRecoveryRunnable);
    }

    private void stopWifiRecoveryLoop() {
        if (wifiRecoveryRunnable != null) {
            mainHandler.removeCallbacks(wifiRecoveryRunnable);
            wifiRecoveryRunnable = null;
        }
    }

    @SuppressWarnings("deprecation")
    private void ensureWifiAvailable() {
        WifiManager manager = wifiManager;
        if (manager == null) {
            return;
        }
        try {
            if (!manager.isWifiEnabled()) {
                boolean enabled = manager.setWifiEnabled(true);
                Log.w(TAG, "WiFi disabled by system; setWifiEnabled(true)=" + enabled);
                if (enabled) {
                    showDetail("WiFi被系统关闭，正在自动恢复");
                }
                return;
            }

            if (isNetworkConnected()) {
                return;
            }

            long now = System.currentTimeMillis();
            if (now - lastWifiReconnectAt >= WIFI_RECONNECT_MIN_INTERVAL_MS) {
                lastWifiReconnectAt = now;
                boolean reconnect = manager.reconnect();
                Log.w(TAG, "WiFi enabled but no active network; reconnect=" + reconnect);
            }
        } catch (SecurityException e) {
            Log.e(TAG, "ensureWifiAvailable missing permission", e);
        } catch (Exception e) {
            Log.e(TAG, "ensureWifiAvailable failed", e);
        }
    }

    private boolean isNetworkConnected() {
        ConnectivityManager manager = connectivityManager;
        if (manager == null) {
            return false;
        }
        Network network = manager.getActiveNetwork();
        if (network == null) {
            return false;
        }
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private boolean isRtcBusy() {
        return isStartingSession
                || isRecordingActive
                || isRtcSessionActive
                || currentRtcSession != null
                || rtcRoom != null
                || rtcEngine != null;
    }

    private boolean isTtsPlaying() {
        synchronized (ttsLock) {
            return ttsPlayer != null;
        }
    }

    private void boostTtsOutputVolume(String reason) {
        try {
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager == null) {
                return;
            }
            setMaxStreamVolume(audioManager, AudioManager.STREAM_MUSIC, "music", reason);
            setMaxStreamVolume(audioManager, AudioManager.STREAM_ACCESSIBILITY, "accessibility", reason);
            setMaxStreamVolume(audioManager, AudioManager.STREAM_VOICE_CALL, "voice_call", reason);
            setMaxStreamVolume(audioManager, STREAM_TTS_COMPAT, "tts", reason);
            setMaxStreamVolume(audioManager, STREAM_ASSISTANT_COMPAT, "assistant", reason);
        } catch (Exception e) {
            Log.e(TAG, "boostTtsOutputVolume failed: " + reason, e);
        }
    }

    private void setMaxStreamVolume(AudioManager audioManager, int streamType, String label, String reason) {
        try {
            int maxVolume = audioManager.getStreamMaxVolume(streamType);
            int currentVolume = audioManager.getStreamVolume(streamType);
            if (maxVolume > 0 && currentVolume < maxVolume) {
                audioManager.setStreamVolume(streamType, maxVolume, 0);
            }
            Log.d(TAG, "TTS volume boost stream=" + label + " before=" + currentVolume
                    + " max=" + maxVolume + " reason=" + reason);
        } catch (Exception e) {
            Log.e(TAG, "setMaxStreamVolume failed stream=" + label + " reason=" + reason, e);
        }
    }

    private String autoPhotoLabel() {
        return "每" + (AUTO_PHOTO_INTERVAL_MS / 1000L) + "秒拍照上传";
    }

    private void showBossTtsOverlay(String text, String voiceType) {
        String safeText = text == null || text.trim().isEmpty() ? "老板正在讲话..." : text.trim();
        mainHandler.post(() -> {
            if (bossTtsOverlay == null || bossTtsSubtitleView == null) {
                return;
            }
            setBossTtsAvatar(voiceType);
            bossTtsSubtitleView.setText(safeText);
            if (userRtcSubtitleRow != null) {
                userRtcSubtitleRow.setVisibility(View.GONE);
            }
            bossTtsOverlay.setVisibility(View.VISIBLE);
            Log.d(TAG, "boss TTS overlay shown voiceType=" + voiceType
                    + " speaker=" + speakerNameForVoiceType(voiceType) + " text=" + safeText);
        });
    }

    private void setBossTtsAvatar(String voiceType) {
        if (bossTtsAvatarView == null) {
            return;
        }
        bossTtsAvatarView.setImageResource(avatarResForVoiceType(voiceType));
        Drawable drawable = bossTtsAvatarView.getDrawable();
        if (drawable instanceof Animatable) {
            ((Animatable) drawable).start();
        }
    }

    private int avatarResForVoiceType(String voiceType) {
        String safeVoiceType = voiceType == null ? "" : voiceType.trim();
        switch (safeVoiceType) {
            case "S_LoL68Oa42":
                return R.drawable.dongmingzhu_avatar;
            case "S_MoL68Oa42":
                return R.drawable.liuqiangdong_avatar;
            case "S_NoL68Oa42":
                return R.drawable.leijun_avatar;
            case "S_OoL68Oa42":
            default:
                return R.drawable.mayun_avatar;
        }
    }

    private String speakerNameForVoiceType(String voiceType) {
        String safeVoiceType = voiceType == null ? "" : voiceType.trim();
        switch (safeVoiceType) {
            case "S_LoL68Oa42":
                return "董明珠";
            case "S_MoL68Oa42":
                return "刘强东";
            case "S_NoL68Oa42":
                return "雷军";
            case "S_OoL68Oa42":
            default:
                return "马云";
        }
    }

    private void hideBossTtsOverlay() {
        mainHandler.post(() -> {
            if (bossTtsOverlay != null) {
                bossTtsOverlay.setVisibility(View.GONE);
            }
            if (bossTtsSubtitleView != null) {
                bossTtsSubtitleView.setText("");
            }
            if (userRtcSubtitleView != null) {
                userRtcSubtitleView.setText("");
            }
            if (userRtcSubtitleRow != null) {
                userRtcSubtitleRow.setVisibility(View.GONE);
            }
        });
    }

    private void showRtcSubtitlePlaceholder() {
        mainHandler.post(() -> {
            if (bossTtsOverlay == null || bossTtsSubtitleView == null || userRtcSubtitleView == null) {
                return;
            }
            setBossTtsAvatar(currentTtsVoiceType);
            latestBossRtcSubtitle = "";
            latestUserRtcSubtitle = "";
            bossTtsSubtitleView.setText("马云: 等待老板开场");
            userRtcSubtitleView.setText("我: 等待我的回复");
            if (userRtcSubtitleRow != null) {
                userRtcSubtitleRow.setVisibility(View.VISIBLE);
            }
            bossTtsOverlay.setVisibility(View.VISIBLE);
        });
    }

    private void updateRtcSubtitle(String userId, String text, boolean definite, boolean paragraph, String source) {
        String safeText = text == null ? "" : text.trim();
        if (safeText.isEmpty()) {
            return;
        }
        if (bossTtsOverlay == null || bossTtsSubtitleView == null || userRtcSubtitleView == null) {
            return;
        }
        boolean localUser = isLocalRtcUser(userId);
        boolean shouldExitRtc = !localUser && safeText.contains(RTC_EXIT_SUBTITLE_MARKER);
        boolean shouldExitRtcByKeyword = !localUser
                && !shouldExitRtc
                && safeText.contains(RTC_EXIT_SUBTITLE_KEYWORD);
        if (shouldExitRtc) {
            safeText = safeText.replace(RTC_EXIT_SUBTITLE_MARKER, "").trim();
        }
        if (safeText.isEmpty() && !shouldExitRtc) {
            return;
        }
        if (localUser) {
            latestUserRtcSubtitle = safeText;
        } else {
            if (!safeText.isEmpty()) {
                latestBossRtcSubtitle = safeText;
            }
            if (definite || paragraph) {
                latestUserRtcSubtitle = "";
            }
        }
        setBossTtsAvatar(currentTtsVoiceType);
        String bossText = latestBossRtcSubtitle == null || latestBossRtcSubtitle.isEmpty()
                ? "正在听..."
                : latestBossRtcSubtitle;
        String userText = latestUserRtcSubtitle == null || latestUserRtcSubtitle.isEmpty()
                ? (localUser ? "等待识别..." : "等待我的回复")
                : latestUserRtcSubtitle;
        bossTtsSubtitleView.setText("马云: " + bossText);
        userRtcSubtitleView.setText("我: " + userText);
        if (userRtcSubtitleRow != null) {
            userRtcSubtitleRow.setVisibility(View.VISIBLE);
        }
        bossTtsOverlay.setVisibility(View.VISIBLE);
        showDetail("RTC字幕(" + source + "): " + (localUser ? "我" : "马云")
                + (definite || paragraph ? " 完整" : " 实时"));
        if (shouldExitRtc) {
            handleRtcExitSubtitleMarker(source, "标识", RTC_EXIT_MARKER_DELAY_MS);
        } else if (shouldExitRtcByKeyword) {
            handleRtcExitSubtitleMarker(source, "关键词结束", RTC_EXIT_KEYWORD_DELAY_MS);
        }
    }

    private void handleRtcExitSubtitleMarker(String source, String reason, long delayMs) {
        if (rtcExitMarkerHandled) {
            return;
        }
        rtcExitMarkerHandled = true;
        Log.d(TAG, "RTC exit subtitle received reason=" + reason + " source=" + source);
        showDetail("收到 RTC 结束字幕" + reason + "，准备退出谈话");
        mainHandler.postDelayed(() -> {
            if (isRtcBusy()) {
                stopBossTalk("subtitle-" + reason + ":" + source);
            }
        }, delayMs);
    }

    private boolean isLocalRtcUser(String userId) {
        String safeUserId = userId == null ? "" : userId.trim();
        if (safeUserId.isEmpty()) {
            return false;
        }
        RtcSessionInfo session = currentRtcSession;
        if (session != null && safeUserId.equals(session.userId)) {
            return true;
        }
        String agentUserId = currentRtcAgentUserId == null ? "" : currentRtcAgentUserId.trim();
        if (!agentUserId.isEmpty() && safeUserId.equals(agentUserId)) {
            return false;
        }
        String lower = safeUserId.toLowerCase(Locale.US);
        return lower.contains("glasses") || lower.contains("user");
    }

    private void handleRtcTextMessage(String userId, String message, String source) {
        String safeMessage = message == null ? "" : message.trim();
        if (safeMessage.isEmpty()) {
            return;
        }
        String resolvedUserId = userId == null ? "" : userId.trim();
        String text = "";
        try {
            if (safeMessage.startsWith("{")) {
                JSONObject root = new JSONObject(safeMessage);
                resolvedUserId = firstNonEmpty(
                        root.optString("userId", ""),
                        root.optString("uid", ""),
                        root.optString("sender", ""),
                        root.optString("senderId", ""),
                        resolvedUserId
                );
                text = firstNonEmpty(
                        root.optString("text", ""),
                        root.optString("content", ""),
                        root.optString("message", ""),
                        root.optString("subtitle", "")
                );
                JSONObject data = root.optJSONObject("data");
                if (text.isEmpty() && data != null) {
                    resolvedUserId = firstNonEmpty(
                            data.optString("userId", ""),
                            data.optString("uid", ""),
                            data.optString("sender", ""),
                            data.optString("senderId", ""),
                            resolvedUserId
                    );
                    text = firstNonEmpty(
                            data.optString("text", ""),
                            data.optString("content", ""),
                            data.optString("message", ""),
                            data.optString("subtitle", "")
                    );
                }
            } else {
                text = safeMessage;
            }
        } catch (Exception e) {
            text = safeMessage;
        }
        String finalUserId = resolvedUserId;
        String finalText = text == null ? "" : text.trim();
        if (finalText.isEmpty()) {
            return;
        }
        runOnUiThread(() -> updateRtcSubtitle(finalUserId, finalText, true, true, source));
    }

    private void handleRtcBinarySubtitleMessage(String fallbackUserId, ByteBuffer message, String source) {
        if (message == null) {
            return;
        }
        try {
            byte[] bytes = readByteBuffer(message);
            String jsonText = unpackRtcSubtitlePayload(bytes);
            if (jsonText.isEmpty()) {
                return;
            }
            if (jsonText.equals(latestBinarySubtitlePayload)) {
                return;
            }
            latestBinarySubtitlePayload = jsonText;
            Log.d(TAG, "binary subtitle payload source=" + source + " json=" + trimForLog(jsonText));
            parseRtcSubtitlePayload(fallbackUserId, jsonText, source);
        } catch (Exception e) {
            Log.e(TAG, "handleRtcBinarySubtitleMessage failed source=" + source, e);
        }
    }

    private byte[] readByteBuffer(ByteBuffer message) {
        ByteBuffer duplicate = message.duplicate();
        byte[] bytes = new byte[duplicate.remaining()];
        duplicate.get(bytes);
        return bytes;
    }

    private String unpackRtcSubtitlePayload(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        if (bytes.length >= RTC_SUBTITLE_HEADER_SIZE && isRtcSubtitleMagic(bytes)) {
            int length = readBigEndianInt(bytes, 4);
            int available = bytes.length - RTC_SUBTITLE_HEADER_SIZE;
            if (length <= 0 || length > available) {
                length = available;
            }
            return new String(bytes, RTC_SUBTITLE_HEADER_SIZE, length, StandardCharsets.UTF_8).trim();
        }
        return new String(bytes, StandardCharsets.UTF_8).trim();
    }

    private boolean isRtcSubtitleMagic(byte[] bytes) {
        return bytes[0] == 's' && bytes[1] == 'u' && bytes[2] == 'b' && bytes[3] == 'v';
    }

    private int readBigEndianInt(byte[] bytes, int offset) {
        return ((bytes[offset] & 0xff) << 24)
                | ((bytes[offset + 1] & 0xff) << 16)
                | ((bytes[offset + 2] & 0xff) << 8)
                | (bytes[offset + 3] & 0xff);
    }

    private void parseRtcSubtitlePayload(String fallbackUserId, String jsonText, String source) {
        try {
            JSONObject root = new JSONObject(jsonText);
            JSONArray dataArray = root.optJSONArray("data");
            if (dataArray != null) {
                for (int i = 0; i < dataArray.length(); i++) {
                    JSONObject item = dataArray.optJSONObject(i);
                    if (item != null) {
                        handleRtcSubtitleItem(fallbackUserId, item, source);
                    }
                }
                return;
            }

            JSONObject data = root.optJSONObject("data");
            if (data != null) {
                handleRtcSubtitleItem(fallbackUserId, data, source);
                return;
            }

            handleRtcSubtitleItem(fallbackUserId, root, source);
        } catch (Exception e) {
            Log.e(TAG, "parseRtcSubtitlePayload failed json=" + trimForLog(jsonText), e);
        }
    }

    private void handleRtcSubtitleItem(String fallbackUserId, JSONObject item, String source) {
        String uid = firstNonEmpty(
                item.optString("userId", ""),
                item.optString("user_id", ""),
                item.optString("uid", ""),
                item.optString("sender", ""),
                item.optString("senderId", ""),
                item.optString("speaker", ""),
                item.optString("speakerId", ""),
                fallbackUserId
        );
        String text = firstNonEmpty(
                item.optString("text", ""),
                item.optString("content", ""),
                item.optString("message", ""),
                item.optString("subtitle", "")
        );
        if (text.isEmpty()) {
            return;
        }
        boolean definite = item.optBoolean("definite", item.optBoolean("isFinal", item.optBoolean("final", false)));
        boolean paragraph = item.optBoolean("paragraph", item.optBoolean("isParagraph", false));
        int sequence = item.optInt("sequence", item.optInt("seq", -1));
        String roundId = firstNonEmpty(item.optString("roundId", ""), item.optString("round_id", ""));
        Log.d(TAG, "parsed subtitle uid=" + uid + " seq=" + sequence + " round=" + roundId
                + " definite=" + definite + " paragraph=" + paragraph + " text=" + text);
        runOnUiThread(() -> updateRtcSubtitle(uid, text, definite, paragraph, source));
    }

    private String trimForLog(String text) {
        if (text == null) {
            return "";
        }
        String safeText = text.replace('\n', ' ').replace('\r', ' ');
        return safeText.length() > 500 ? safeText.substring(0, 500) + "..." : safeText;
    }

    private void pauseAutoPhotoForTts(String reason) {
        isAutoPhotoPausedForTts = true;
        stopAutoPhotoLoop();
        Log.d(TAG, "pause auto photo for TTS: " + reason);
        if (cameraStatusView != null) {
            cameraStatusView.setText("TTS播报中: 暂停拍照");
        }
        if (photoPathView != null) {
            photoPathView.setText("播报完成后立即拍照，再恢复10秒循环");
        }
    }

    private void pauseAutoPhotoForRtc(String reason) {
        isAutoPhotoPausedForRtc = true;
        isAutoPhotoPausedForTts = false;
        cancelDelayedRtcCameraResume();
        stopAutoPhotoLoop();
        unbindCamera();
        System.gc();
        Log.d(TAG, "pause auto photo for RTC: " + reason);
        if (cameraStatusView != null) {
            cameraStatusView.setText("RTC会话中: 摄像头已关闭");
        }
        if (photoPathView != null) {
            photoPathView.setText("退出RTC后延迟恢复自动拍照上传");
        }
    }

    private void resumeAutoPhotoAfterRtc(String reason) {
        if (!isAutoPhotoPausedForRtc) {
            return;
        }
        isAutoPhotoPausedForRtc = false;
        if (!isCameraUploadEnabled) {
            showCameraDisabled("后端配置 cameraEnabled=false");
            return;
        }
        if (!isWorn || !hasRuntimePermissions() || isTtsPlaying() || isRtcBusy()) {
            return;
        }
        scheduleDelayedRtcCameraResume(reason);
    }

    private void scheduleDelayedRtcCameraResume(String reason) {
        cancelDelayedRtcCameraResume();
        Log.d(TAG, "schedule camera resume after RTC: " + reason
                + " delayMs=" + RTC_CAMERA_RESUME_DELAY_MS);
        if (cameraStatusView != null) {
            cameraStatusView.setText("RTC已退出: 等待恢复摄像头");
        }
        if (photoPathView != null) {
            photoPathView.setText((RTC_CAMERA_RESUME_DELAY_MS / 1000L) + "秒后恢复自动拍照上传");
        }
        rtcCameraResumeRunnable = () -> {
            rtcCameraResumeRunnable = null;
            if (!isCameraUploadEnabled) {
                showCameraDisabled("后端配置 cameraEnabled=false");
                return;
            }
            if (!isWorn || !hasRuntimePermissions() || isTtsPlaying()) {
                return;
            }
            if (isRtcBusy()) {
                isAutoPhotoPausedForRtc = true;
                return;
            }
            Log.d(TAG, "resume auto photo after RTC delay: " + reason);
            if (cameraStatusView != null) {
                cameraStatusView.setText(R.string.camera_preparing);
            }
            if (photoPathView != null) {
                photoPathView.setText(autoPhotoLabel() + " / category=" + PHOTO_UPLOAD_CATEGORY);
            }
            bindCameraAsync();
        };
        mainHandler.postDelayed(rtcCameraResumeRunnable, RTC_CAMERA_RESUME_DELAY_MS);
    }

    private void cancelDelayedRtcCameraResume() {
        if (rtcCameraResumeRunnable != null) {
            mainHandler.removeCallbacks(rtcCameraResumeRunnable);
            rtcCameraResumeRunnable = null;
        }
    }

    private void resumeAutoPhotoAfterTts(String reason) {
        if (!isCameraUploadEnabled) {
            isAutoPhotoPausedForTts = false;
            showCameraDisabled("后端配置 cameraEnabled=false");
            return;
        }
        if (!isAutoPhotoPausedForTts || !isWorn || !hasRuntimePermissions() || isTtsPlaying() || isRtcBusy()) {
            return;
        }
        isAutoPhotoPausedForTts = false;
        Log.d(TAG, "resume auto photo after TTS: " + reason);
        if (cameraStatusView != null) {
            cameraStatusView.setText(R.string.camera_ready);
        }
        if (photoPathView != null) {
            photoPathView.setText("TTS结束，立即补拍一张");
        }
        if (imageCapture == null || !isCameraReady) {
            bindCameraAsync();
            return;
        }
        takePhoto("tts-complete:" + reason);
        startAutoPhotoLoop(AUTO_PHOTO_INTERVAL_MS);
    }

    private void requestAndPlayTts(String text, String voiceType, String source) {
        String safeText = text == null ? "" : text.trim();
        if (safeText.isEmpty()) {
            Log.d(TAG, "TTS ignored empty text: " + source);
            runOnUiThread(() -> showDetail("TTS文本为空: " + source));
            return;
        }
        if (isRtcBusy()) {
            Log.d(TAG, "TTS ignored because RTC is busy: " + source);
            runOnUiThread(() -> showDetail("RTC会话中，跳过单独TTS: " + source));
            return;
        }
        String selectedVoiceType = resolveTtsVoiceType(voiceType);
        ExecutorService executor = ttsExecutor;
        if (executor == null || executor.isShutdown()) {
            return;
        }
        executor.execute(() -> {
            try {
                if (isRtcBusy()) {
                    Log.d(TAG, "TTS request skipped because RTC became busy: " + source);
                    runOnUiThread(() -> showDetail("RTC正在启动，跳过单独TTS: " + source));
                    return;
                }
                showBossTtsOverlay(safeText, selectedVoiceType);
                boostTtsOutputVolume("before-request:" + source);
                Log.d(TAG, "TTS request start source=" + source + " voiceType=" + selectedVoiceType + " text=" + safeText);
                runOnUiThread(() -> showDetail("请求TTS: " + safeText + " / voice=" + selectedVoiceType));
                byte[] audioBytes = requestTtsMp3(safeText, selectedVoiceType);
                if (audioBytes.length == 0) {
                    throw new IllegalStateException("TTS返回空音频");
                }
                if (isRtcBusy()) {
                    Log.d(TAG, "TTS audio discarded because RTC started");
                    runOnUiThread(() -> showDetail("RTC已开始，丢弃TTS音频"));
                    return;
                }
                File audioFile = writeTtsMp3ToCache(audioBytes);
                Log.d(TAG, "TTS request success bytes=" + audioBytes.length + " file=" + audioFile.getAbsolutePath());
                runOnUiThread(() -> playTtsMp3(audioFile, safeText, selectedVoiceType, source));
            } catch (Exception e) {
                Log.e(TAG, "requestAndPlayTts failed", e);
                runOnUiThread(() -> {
                    showDetail("TTS失败: " + e.getMessage());
                    if (!isRtcBusy()) {
                        hideBossTtsOverlay();
                        resumeAutoPhotoAfterTts("tts-failed:" + source);
                    }
                });
            }
        });
    }

    private String resolveTtsVoiceType(String voiceType) {
        String safeVoiceType = voiceType == null ? "" : voiceType.trim();
        if (!safeVoiceType.isEmpty()) {
            currentTtsVoiceType = safeVoiceType;
            return safeVoiceType;
        }
        safeVoiceType = currentTtsVoiceType == null ? "" : currentTtsVoiceType.trim();
        if (safeVoiceType.isEmpty()) {
            safeVoiceType = TTS_VOICE_TYPE;
            currentTtsVoiceType = safeVoiceType;
        }
        return safeVoiceType;
    }

    private byte[] requestTtsMp3(String text, String voiceType) throws Exception {
        JSONObject body = new JSONObject();
        JSONObject app = new JSONObject();
        app.put("cluster", TTS_CLUSTER);
        body.put("app", app);

        JSONObject user = new JSONObject();
        user.put("uid", "rokid-glasses");
        body.put("user", user);

        JSONObject audio = new JSONObject();
        audio.put("voice_type", voiceType);
        audio.put("encoding", "mp3");
        audio.put("speed_ratio", 0.9);
        body.put("audio", audio);

        JSONObject request = new JSONObject();
        request.put("reqid", "rokid-tts-" + System.currentTimeMillis());
        request.put("text", text);
        request.put("operation", "query");
        body.put("request", request);

        HttpURLConnection connection = (HttpURLConnection) new URL(TTS_URL).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("x-api-key", TTS_API_KEY);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        byte[] requestBytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(requestBytes.length);
        try (OutputStream outputStream = connection.getOutputStream()) {
            outputStream.write(requestBytes);
        }

        JSONObject response = new JSONObject(readResponse(connection));
        int code = response.optInt("code", -1);
        Log.d(TAG, "TTS response code=" + code + " message=" + response.optString("message"));
        if (code != 3000) {
            throw new IllegalStateException("TTS code=" + code + " message=" + response.optString("message"));
        }
        String data = response.optString("data", "");
        if (data.isEmpty()) {
            return new byte[0];
        }
        return Base64.decode(data, Base64.DEFAULT);
    }

    private File writeTtsMp3ToCache(byte[] audioBytes) throws Exception {
        File file = new File(getCacheDir(), "rokid_tts_" + System.currentTimeMillis() + ".mp3");
        try (FileOutputStream outputStream = new FileOutputStream(file)) {
            outputStream.write(audioBytes);
        }
        return file;
    }

    private void playTtsMp3(File audioFile, String text, String voiceType, String source) {
        if (isRtcBusy()) {
            Log.d(TAG, "TTS play skipped because RTC is busy");
            showDetail("RTC会话中，跳过TTS播放");
            return;
        }
        stopTtsPlayback("replace");
        try {
            MediaPlayer player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            player.setVolume(1.0f, 1.0f);
            player.setDataSource(audioFile.getAbsolutePath());
            player.setOnPreparedListener(mp -> {
                if (isRtcBusy()) {
                    Log.d(TAG, "TTS prepared but RTC is busy, stop playback");
                    stopTtsPlayerOnly("rtc-before-play");
                    return;
                }
                pauseAutoPhotoForTts("tts-play:" + source);
                boostTtsOutputVolume("before-play:" + source);
                showBossTtsOverlay(text, voiceType);
                mp.setVolume(1.0f, 1.0f);
                mp.start();
                mainHandler.postDelayed(() -> boostTtsOutputVolume("after-play:" + source), 350);
                Log.d(TAG, "TTS playback started source=" + source + " voiceType=" + voiceType
                        + " speaker=" + speakerNameForVoiceType(voiceType) + " text=" + text);
                showDetail("TTS播放中: " + text);
            });
            player.setOnCompletionListener(mp -> {
                Log.d(TAG, "TTS playback completed source=" + source);
                stopTtsPlayback("complete");
                if (audioFile.exists() && !audioFile.delete()) {
                    Log.w(TAG, "TTS cache delete failed: " + audioFile.getAbsolutePath());
                }
                resumeAutoPhotoAfterTts("tts-complete:" + source);
                showDetail("TTS播放完成: " + source);
            });
            player.setOnErrorListener((mp, what, extra) -> {
                Log.e(TAG, "TTS playback error what=" + what + " extra=" + extra);
                stopTtsPlayback("error");
                if (audioFile.exists() && !audioFile.delete()) {
                    Log.w(TAG, "TTS cache delete failed: " + audioFile.getAbsolutePath());
                }
                resumeAutoPhotoAfterTts("tts-error:" + source);
                showDetail("TTS播放失败: " + what + "/" + extra);
                return true;
            });
            synchronized (ttsLock) {
                ttsPlayer = player;
            }
            player.prepareAsync();
        } catch (Exception e) {
            Log.e(TAG, "playTtsMp3 failed", e);
            stopTtsPlayback("play-failed");
            hideBossTtsOverlay();
            showDetail("TTS播放失败: " + e.getMessage());
        }
    }

    private void stopTtsPlayerOnly(String reason) {
        MediaPlayer player;
        synchronized (ttsLock) {
            player = ttsPlayer;
            ttsPlayer = null;
        }
        releaseTtsPlayer(player, reason);
    }

    private void stopTtsPlayback(String reason) {
        hideBossTtsOverlay();
        MediaPlayer player;
        synchronized (ttsLock) {
            player = ttsPlayer;
            ttsPlayer = null;
        }
        releaseTtsPlayer(player, reason);
    }

    private void releaseTtsPlayer(MediaPlayer player, String reason) {
        if (player == null) {
            return;
        }
        try {
            if (player.isPlaying()) {
                player.stop();
            }
        } catch (Exception e) {
            Log.e(TAG, "stopTtsPlayback stop failed: " + reason, e);
        }
        try {
            player.release();
        } catch (Exception e) {
            Log.e(TAG, "stopTtsPlayback release failed: " + reason, e);
        }
    }

    private void startStatusPolling() {
        if (statusPollingEnabled) {
            return;
        }
        statusPollingEnabled = true;
        ExecutorService executor = statusPollExecutor;
        if (executor == null || executor.isShutdown() || statusPollInFlight) {
            return;
        }
        statusPollInFlight = true;
        executor.execute(() -> {
            try {
                runGlassesEventStreamLoop();
            } finally {
                statusPollInFlight = false;
            }
        });
    }

    private void stopStatusPolling() {
        statusPollingEnabled = false;
        if (statusPollRunnable != null) {
            mainHandler.removeCallbacks(statusPollRunnable);
            statusPollRunnable = null;
        }
    }

    private void runGlassesEventStreamLoop() {
        int failureCount = 0;
        while (statusPollingEnabled) {
            HttpURLConnection connection = null;
            try {
                String url = BACKEND_BASE_URL
                        + "/glasses/events?deviceId=" + encode(GLASSES_DEVICE_ID)
                        + "&category=" + encode(PHOTO_UPLOAD_CATEGORY);
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(0);
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Accept", "text/event-stream");
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("SSE HTTP " + code + ": " + new String(readAll(connection.getErrorStream()), StandardCharsets.UTF_8));
                }
                runOnUiThread(() -> showDetail("消息长连接已连接"));
                requestCameraConfig("sse-connected");
                failureCount = 0;
                readSseStream(connection.getInputStream());
            } catch (Exception e) {
                failureCount++;
                Log.e(TAG, "glasses event stream failed", e);
                runOnUiThread(() -> {
                    if (latestStateView != null) {
                        latestStateView.setText("当前状态\n重连中");
                    }
                });
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
            if (statusPollingEnabled) {
                try {
                    long delayMs = Math.min(STATUS_RECONNECT_MAX_DELAY_MS, STATUS_RECONNECT_DELAY_MS * Math.max(1, failureCount));
                    Thread.sleep(delayMs);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    private void requestCameraConfig(String source) {
        if (cameraConfigInFlight) {
            return;
        }
        cameraConfigInFlight = true;
        new Thread(() -> {
            try {
                String url = BACKEND_BASE_URL
                        + "/glasses/config?deviceId=" + encode(GLASSES_DEVICE_ID)
                        + "&category=" + encode(PHOTO_UPLOAD_CATEGORY);
                JSONObject root = new JSONObject(httpGet(url));
                boolean enabled = root.optBoolean("cameraEnabled", false);
                runOnUiThread(() -> applyCameraConfig(enabled, source));
            } catch (Exception e) {
                Log.e(TAG, "requestCameraConfig failed", e);
                runOnUiThread(() -> {
                    cameraConfigLoaded = true;
                    isCameraUploadEnabled = false;
                    stopAutoPhotoLoop();
                    unbindCamera();
                    showCameraDisabled("摄像头配置获取失败，默认关闭");
                    showDetail("摄像头配置失败: " + e.getMessage());
                });
            } finally {
                cameraConfigInFlight = false;
            }
        }, "RokidCameraConfig").start();
    }

    private void applyCameraConfig(boolean enabled, String source) {
        cameraConfigLoaded = true;
        isCameraUploadEnabled = enabled;
        Log.d(TAG, "camera config: enabled=" + enabled + " source=" + source);
        if (!enabled) {
            stopAutoPhotoLoop();
            isAutoPhotoPausedForTts = false;
            unbindCamera();
            showCameraDisabled("后端配置 cameraEnabled=false");
            showDetail("摄像头配置: 关闭 / " + source);
            return;
        }

        showDetail("摄像头配置: 开启 / " + source);
        if (cameraStatusView != null) {
            cameraStatusView.setText(isCameraReady ? R.string.camera_ready : R.string.camera_preparing);
        }
        if (photoPathView != null) {
            photoPathView.setText(autoPhotoLabel() + " / category=" + PHOTO_UPLOAD_CATEGORY);
        }
        if (!isWorn) {
            stopAutoPhotoLoop();
            unbindCamera();
            if (cameraStatusView != null) {
                cameraStatusView.setText("摘下: 摄像头已关闭");
            }
            if (photoPathView != null) {
                photoPathView.setText("佩戴后重新绑定摄像头并恢复上传");
            }
            return;
        }
        if (!hasRuntimePermissions()) {
            return;
        }
        if (isTtsPlaying()) {
            isAutoPhotoPausedForTts = true;
            if (photoPathView != null) {
                photoPathView.setText("TTS播报中，暂不恢复拍照");
            }
            return;
        }
        if (isRtcBusy()) {
            pauseAutoPhotoForRtc("camera-config:" + source);
            return;
        }
        if (isCameraReady && imageCapture != null) {
            startAutoPhotoLoop();
        } else {
            bindCameraAsync();
        }
    }

    private void showCameraDisabled(String reason) {
        if (cameraStatusView != null) {
            cameraStatusView.setText("摄像头关闭");
        }
        if (photoPathView != null) {
            photoPathView.setText(reason);
        }
    }

    private void readSseStream(InputStream inputStream) throws Exception {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            String eventType = "message";
            StringBuilder data = new StringBuilder();
            String line;
            while (statusPollingEnabled && (line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    handleSseEvent(eventType, data.toString());
                    eventType = "message";
                    data.setLength(0);
                } else if (line.startsWith("event:")) {
                    eventType = line.substring("event:".length()).trim();
                } else if (line.startsWith("data:")) {
                    if (data.length() > 0) {
                        data.append('\n');
                    }
                    String value = line.substring("data:".length());
                    data.append(value.startsWith(" ") ? value.substring(1) : value);
                }
            }
        }
    }

    private void handleSseEvent(String eventType, String data) {
        if (data == null || data.isEmpty()) {
            return;
        }
        try {
            JSONObject root = new JSONObject(data);
            if ("status".equals(eventType)) {
                if (System.currentTimeMillis() < manualStatusOverrideUntilMs) {
                    Log.d(TAG, "status event ignored due manual override");
                    return;
                }
                String scene = root.optString("scene", root.optString("state", "一个人的默认"));
                String analysisStatus = root.optString("analysisStatus", "");
                double confidence = root.optDouble("confidence", 0.0);
                String updatedAt = root.optString("updatedAtIso", "");
                runOnUiThread(() -> updateLatestState(scene, analysisStatus, confidence, updatedAt));
            } else if ("command".equals(eventType)) {
                handleCommandEvent(root);
            }
        } catch (Exception e) {
            Log.e(TAG, "handleSseEvent failed: " + eventType + " data=" + data, e);
        }
    }

    private void handleCommandEvent(JSONObject root) {
        String type = root.optString("type", "message");
        String text = root.optString("text", root.optString("message", root.optString("content", type)));
        if (isOnboardingTrainingCommand(type)) {
            runOnUiThread(() -> startOnboardingTraining("sse:" + type));
        } else if ("boss_talk".equals(type) || "find_boss_talk".equals(type)) {
            runOnUiThread(() -> startBossTalk("sse:" + type));
        } else if ("exit_boss_talk".equals(type) || "stop_boss_talk".equals(type)) {
            boolean force = root.optBoolean("force", root.optBoolean("forceExit", false));
            runOnUiThread(() -> stopBossTalkFromRemote("sse:" + type, force));
        } else if (isStatusCommand(type)) {
            String scene = firstNonEmpty(root.optString("scene", ""), root.optString("state", ""), "一个人的默认");
            String analysisStatus = firstNonEmpty(root.optString("analysisStatus", ""), root.optString("source", ""), "manual");
            double confidence = root.optDouble("confidence", 1.0);
            String updatedAt = root.optString("updatedAtIso", "");
            long durationMs = root.optLong("durationMs", root.optLong("ttlMs", 600000L));
            manualStatusOverrideUntilMs = durationMs <= 0 ? 0L : System.currentTimeMillis() + durationMs;
            Log.d(TAG, "web status command scene=" + scene + " source=" + analysisStatus
                    + " confidence=" + confidence + " durationMs=" + durationMs);
            runOnUiThread(() -> {
                updateLatestState(scene, analysisStatus, confidence, updatedAt);
                showDetail("网页下发状态: " + scene);
            });
        } else if (isTtsCommand(type)) {
            if (isRtcBusy()) {
                Log.d(TAG, "TTS command ignored because RTC is busy: " + type);
                runOnUiThread(() -> showDetail("RTC会话中，忽略TTS命令: " + type));
                return;
            }
            requestAndPlayTts(text, extractTtsVoiceType(root), "sse:" + type);
        } else if (isTextCommand(type)) {
            String title = firstNonEmpty(root.optString("title", ""), "网页消息");
            Log.d(TAG, "web text command title=" + title + " text=" + text);
            runOnUiThread(() -> {
                statusView.setText(title);
                showDetail(text);
            });
        } else {
            runOnUiThread(() -> showDetail("后端消息: " + text));
        }
    }

    private void stopBossTalkFromRemote(String source, boolean force) {
        if (isRtcBusy() && !force) {
            Log.d(TAG, "remote RTC stop ignored because RTC has priority: " + source);
            statusView.setText("老板谈话中");
            updateBossTalkButton(true);
            showDetail("RTC最高优先级，忽略远程退出: " + source);
            return;
        }
        stopBossTalk(source + (force ? ":force" : ""));
    }

    private String extractTtsVoiceType(JSONObject root) {
        String direct = firstNonEmpty(
                root.optString("voiceType", ""),
                root.optString("voice_type", ""),
                root.optString("speaker", ""),
                root.optString("speakerId", ""),
                root.optString("voice", "")
        );
        if (!direct.isEmpty()) {
            return direct;
        }

        JSONObject audio = root.optJSONObject("audio");
        if (audio != null) {
            String audioVoice = firstNonEmpty(
                    audio.optString("voiceType", ""),
                    audio.optString("voice_type", ""),
                    audio.optString("speaker", ""),
                    audio.optString("speakerId", ""),
                    audio.optString("voice", "")
            );
            if (!audioVoice.isEmpty()) {
                return audioVoice;
            }
        }

        JSONObject tts = root.optJSONObject("tts");
        if (tts != null) {
            return firstNonEmpty(
                    tts.optString("voiceType", ""),
                    tts.optString("voice_type", ""),
                    tts.optString("speaker", ""),
                    tts.optString("speakerId", ""),
                    tts.optString("voice", "")
            );
        }
        return "";
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) {
            return "";
        }
        for (String value : values) {
            String safeValue = value == null ? "" : value.trim();
            if (!safeValue.isEmpty()) {
                return safeValue;
            }
        }
        return "";
    }

    private boolean isTtsCommand(String type) {
        return "tts".equals(type)
                || "play_tts".equals(type)
                || "speak".equals(type)
                || "tts_text".equals(type);
    }

    private boolean isOnboardingTrainingCommand(String type) {
        return "start_onboarding_training".equals(type)
                || "onboarding_training".equals(type)
                || "start_onboarding".equals(type)
                || "entry_training".equals(type);
    }

    private boolean isStatusCommand(String type) {
        return "status".equals(type)
                || "set_status".equals(type)
                || "state".equals(type)
                || "set_state".equals(type)
                || "scene".equals(type)
                || "set_scene".equals(type);
    }

    private boolean isTextCommand(String type) {
        return "message".equals(type)
                || "text".equals(type)
                || "show_text".equals(type)
                || "display_text".equals(type);
    }

    private void updateLatestState(String scene, String analysisStatus, double confidence, String updatedAt) {
        if (latestStateView == null) {
            return;
        }
        String safeScene = scene == null || scene.isEmpty() ? "一个人的默认" : scene;
        String safeStatus = analysisStatus == null || analysisStatus.isEmpty() ? "unknown" : analysisStatus;
        if ("empty".equals(safeStatus)) {
            latestStateView.setText("当前状态\n暂无");
            return;
        }
        latestStateView.setText("当前状态\n" + safeScene);
    }

    private void handleTakeStatusChanged(String state) {
        if (TAKE_STATE_WORN.equals(state)) {
            handleWorn();
        } else if (TAKE_STATE_OFF.equals(state)) {
            handleTakeOff();
        } else {
            showDetail("未知佩戴状态: " + state);
            requestTakeStatusRefresh("take-broadcast-unknown");
        }
    }

    private void handleWorn() {
        boolean changed = !isWorn;
        isWorn = true;
        if (latestStateView != null && changed) {
            latestStateView.setText("佩戴状态\n已佩戴");
        }
        if (!isCameraUploadEnabled) {
            showCameraDisabled(cameraConfigLoaded ? "后端配置 cameraEnabled=false" : "等待后端摄像头配置");
            showDetail("佩戴状态: 已佩戴，摄像头未开启");
            return;
        }
        if (cameraStatusView != null) {
            cameraStatusView.setText(isCameraReady ? R.string.camera_ready : R.string.camera_preparing);
        }
        if (photoPathView != null) {
            photoPathView.setText(autoPhotoLabel() + " / category=" + PHOTO_UPLOAD_CATEGORY);
        }
        if (hasRuntimePermissions()) {
            if (isTtsPlaying()) {
                isAutoPhotoPausedForTts = true;
                photoPathView.setText("TTS播报中，暂不恢复拍照");
            } else if (isRtcBusy()) {
                pauseAutoPhotoForRtc("worn");
            } else if (isCameraReady && imageCapture != null) {
                if (isAutoPhotoPausedForRtc) {
                    resumeAutoPhotoAfterRtc("worn");
                    return;
                }
                startAutoPhotoLoop();
            } else {
                bindCameraAsync();
            }
        }
        showDetail("佩戴状态: 已佩戴");
    }

    private void handleTakeOff() {
        isWorn = false;
        stopAutoPhotoLoop();
        unbindCamera();
        if (latestStateView != null) {
            latestStateView.setText("佩戴状态\n已摘下");
        }
        if (cameraStatusView != null) {
            cameraStatusView.setText("摘下: 摄像头已关闭");
        }
        if (photoPathView != null) {
            photoPathView.setText("佩戴后重新绑定摄像头并恢复上传");
        }
        if (isRecordingActive) {
            stopRecording("take-off", false);
        }
        isStartingSession = false;
        if (isRtcSessionActive || currentRtcSession != null || rtcRoom != null || rtcEngine != null) {
            releaseRtcSession("take-off", true);
        }
        updateBossTalkButton(false);
        statusView.setText("摘下，AI会话已退出");
        showDetail("佩戴状态: 已摘下，关闭摄像头、停止上传并退出 RTC");
    }

    private void takePhoto(String source) {
        if (!isWorn) {
            if (cameraStatusView != null) {
                cameraStatusView.setText("摘下: 暂停拍照");
            }
            if (photoPathView != null) {
                photoPathView.setText("佩戴后恢复自动拍照上传");
            }
            return;
        }
        if (!isCameraUploadEnabled) {
            showCameraDisabled(cameraConfigLoaded ? "后端配置 cameraEnabled=false" : "等待后端摄像头配置");
            showDetail("摄像头关闭，跳过拍照: " + source);
            return;
        }
        if (isRtcBusy()) {
            pauseAutoPhotoForRtc("take-photo:" + source);
            showDetail("RTC会话中，跳过拍照: " + source);
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            cameraStatusView.setText(R.string.record_permission);
            requestRuntimePermissions();
            return;
        }
        ImageCapture capture = imageCapture;
        if (!isCameraReady || capture == null) {
            takePhotoAfterCameraBind = true;
            takePhotoAfterCameraBindSource = source;
            cameraStatusView.setText(R.string.camera_preparing);
            photoPathView.setText("相机未就绪，正在重新绑定: " + source);
            bindCameraAsync();
            return;
        }
        if (isTtsPlaying()) {
            pauseAutoPhotoForTts("take-photo:" + source);
            cameraStatusView.setText("TTS播报中: 跳过拍照");
            photoPathView.setText("播报完成后立即拍照，再恢复10秒循环");
            return;
        }
        if (isTakingPhoto) {
            photoPathView.setText("上一张照片仍在保存");
            return;
        }
        if (source != null && source.startsWith("auto") && isPhotoUploadInFlight) {
            photoPathView.setText("上一张照片仍在上传，跳过本轮");
            return;
        }

        File photoFile = createPhotoFile();
        if (photoFile == null) {
            cameraStatusView.setText(R.string.camera_failed);
            photoPathView.setText("没有可写照片目录");
            return;
        }

        isTakingPhoto = true;
        cameraStatusView.setText(R.string.camera_taking);
        photoPathView.setText(photoFile.getAbsolutePath());
        ImageCapture.OutputFileOptions options =
                new ImageCapture.OutputFileOptions.Builder(photoFile).build();
        capture.takePicture(options, cameraExecutor, new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(ImageCapture.OutputFileResults outputFileResults) {
                Log.d(TAG, "photo saved: " + photoFile.getAbsolutePath());
                runOnUiThread(() -> {
                    isTakingPhoto = false;
                    releaseCameraAfterSinglePhoto("saved:" + source);
                    if (!isWorn) {
                        cameraStatusView.setText("摘下: 丢弃已保存照片");
                        photoPathView.setText(photoFile.getAbsolutePath());
                        showDetail("摘下后照片保存完成，跳过上传: " + source);
                        if (photoFile.exists() && !photoFile.delete()) {
                            Log.w(TAG, "delete photo skipped after take-off failed: " + photoFile.getAbsolutePath());
                        }
                        return;
                    }
                    cameraStatusView.setText(R.string.camera_saved);
                    photoPathView.setText(photoFile.getAbsolutePath());
                    showDetail("拍照完成，准备上传: " + source);
                    uploadPhotoAsync(photoFile, source);
                });
            }

            @Override
            public void onError(ImageCaptureException exception) {
                Log.e(TAG, "takePhoto failed", exception);
                runOnUiThread(() -> {
                    isTakingPhoto = false;
                    releaseCameraAfterSinglePhoto("error:" + source);
                    cameraStatusView.setText(R.string.camera_failed);
                    photoPathView.setText(exception.getMessage());
                });
            }
        });
    }

    private void uploadPhotoAsync(File photoFile, String source) {
        ExecutorService executor = photoUploadExecutor;
        if (executor == null || executor.isShutdown()) {
            return;
        }
        if (!isWorn) {
            Log.d(TAG, "upload skipped because glasses are not worn: " + source);
            runOnUiThread(() -> {
                if (cameraStatusView != null) {
                    cameraStatusView.setText("摘下: 跳过上传");
                }
                if (photoPathView != null) {
                    photoPathView.setText(photoFile == null ? "未佩戴" : photoFile.getAbsolutePath());
                }
                showDetail("摘下状态，照片不上传: " + source);
            });
            if (photoFile != null && photoFile.exists() && !photoFile.delete()) {
                Log.w(TAG, "delete skipped upload photo failed: " + photoFile.getAbsolutePath());
            }
            return;
        }
        if (isPhotoUploadInFlight) {
            runOnUiThread(() -> photoPathView.setText("已有照片上传中，跳过: " + photoFile.getName()));
            return;
        }
        isPhotoUploadInFlight = true;
        executor.execute(() -> {
            try {
                if (!isWorn) {
                    Log.d(TAG, "upload worker skipped because glasses are not worn: " + source);
                    if (photoFile.exists() && !photoFile.delete()) {
                        Log.w(TAG, "delete worker skipped photo failed: " + photoFile.getAbsolutePath());
                    }
                    return;
                }
                String response = uploadImageFile(photoFile, PHOTO_UPLOAD_CATEGORY);
                JSONObject root = new JSONObject(response);
                JSONObject item = root.optJSONObject("item");
                String imageUrl = item == null ? "" : item.optString("url", "");
                int count = ++uploadedPhotoCount;
                runOnUiThread(() -> {
                    cameraStatusView.setText("照片已上传 #" + count);
                    photoPathView.setText(imageUrl.isEmpty() ? photoFile.getName() : imageUrl);
                    showDetail(autoPhotoLabel() + "中 / category=" + PHOTO_UPLOAD_CATEGORY + " / source=" + source);
                });
                Log.d(TAG, "photo uploaded: " + response);
            } catch (Exception e) {
                Log.e(TAG, "uploadPhotoAsync failed", e);
                runOnUiThread(() -> {
                    cameraStatusView.setText("照片上传失败");
                    photoPathView.setText(photoFile.getAbsolutePath());
                    showDetail("上传失败: " + e.getMessage());
                });
            } finally {
                isPhotoUploadInFlight = false;
            }
        });
    }

    private File createPhotoFile() {
        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        File publicDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "bare_photo");
        if ((publicDir.exists() || publicDir.mkdirs()) && publicDir.canWrite()) {
            return new File(publicDir, timeStamp + ".jpg");
        }

        File picturesDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (picturesDir != null) {
            File fallbackDir = new File(picturesDir, "bare_photo");
            if ((fallbackDir.exists() || fallbackDir.mkdirs()) && fallbackDir.canWrite()) {
                return new File(fallbackDir, timeStamp + ".jpg");
            }
        }
        return null;
    }

    private void unbindCamera() {
        isCameraReady = false;
        imageCapture = null;
        takePhotoAfterCameraBind = false;
        takePhotoAfterCameraBindSource = "";
        if (cameraProvider != null) {
            try {
                cameraProvider.unbindAll();
            } catch (Exception e) {
                Log.e(TAG, "camera unbind failed", e);
            }
            cameraProvider = null;
        }
    }

    private void releaseCameraAfterSinglePhoto(String source) {
        if (imageCapture == null && cameraProvider == null) {
            return;
        }
        Log.d(TAG, "release camera after single photo: " + source);
        unbindCamera();
        System.gc();
    }

    private AudioRecord createRecorder() {
        try {
            AudioRecord candidate = new AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.MIC)
                    .setAudioFormat(
                            new AudioFormat.Builder()
                                    .setSampleRate(SAMPLE_RATE)
                                    .setChannelMask(AUDIO_CHANNEL)
                                    .setEncoding(AUDIO_FORMAT)
                                    .build()
                    )
                    .build();

            if (candidate.getState() == AudioRecord.STATE_INITIALIZED) {
                return candidate;
            }
            candidate.release();
        } catch (Exception e) {
            Log.e(TAG, "createRecorder failed", e);
        }
        return null;
    }

    private File createRecordingFile() {
        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        File publicDir = new File(Environment.getExternalStorageDirectory(), "Audio");
        if ((publicDir.exists() || publicDir.mkdirs()) && publicDir.canWrite()) {
            return new File(publicDir, "rokid_record_" + timeStamp + ".pcm");
        }

        File fallbackDir = getExternalFilesDir("Audio");
        if (fallbackDir != null && (fallbackDir.exists() || fallbackDir.mkdirs())) {
            return new File(fallbackDir, "rokid_record_" + timeStamp + ".pcm");
        }

        return null;
    }

    private void writeAudioDataToFile(AudioRecord activeRecorder, File activeFile) {
        byte[] buffer = new byte[BUFFER_SIZE];
        try (FileOutputStream outputStream = new FileOutputStream(activeFile)) {
            while (isRecordingActive) {
                int read = activeRecorder.read(buffer, 0, buffer.length);
                if (read > 0) {
                    currentRecordingBytes += read;
                    handleRealtimeAudioFrame(buffer, read);
                    outputStream.write(buffer, 0, read);
                } else if (read < 0) {
                    Log.e(TAG, "AudioRecord read error: " + read);
                }
            }
            outputStream.flush();
        } catch (Exception e) {
            Log.e(TAG, "writeAudioDataToFile failed", e);
            runOnUiThread(() -> failRecording("写入失败: " + e.getMessage()));
        }
    }

    private void handleRealtimeAudioFrame(byte[] interleavedPcm16, int byteCount) {
        ExternalAudioPusher pusher = audioPusher;
        if (pusher != null) {
            pusher.offerEightChannelPcm16(interleavedPcm16, byteCount);
        }
    }

    private void stopRecording(String source) {
        stopRecording(source, true);
    }

    private void stopRecording(String source, boolean waitForReply) {
        AudioRecord activeRecorder;
        Thread activeThread;
        File activeFile;
        long bytes;
        String mode;
        synchronized (recordLock) {
            activeRecorder = recorder;
            activeThread = recordingThread;
            activeFile = currentRecordingFile;
            bytes = currentRecordingBytes;
            mode = currentRecordMode;
            isRecordingActive = false;
            isStartingSession = false;
            recorder = null;
            recordingThread = null;
        }

        if (activeRecorder != null) {
            try {
                activeRecorder.stop();
            } catch (Exception e) {
                Log.e(TAG, "stop failed", e);
            }
        }

        if (activeThread != null && activeThread != Thread.currentThread()) {
            try {
                activeThread.join(1500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        if (activeRecorder != null) {
            activeRecorder.release();
        }

        if (activeFile != null) {
            if (waitForReply) {
                statusView.setText(R.string.record_stopped_waiting);
            } else {
                statusView.setText("谈话录音已停止");
            }
            pathView.setText(activeFile.getAbsolutePath());
            showDetail(mode + " / bytes=" + bytes + " / 触发源: " + source);
            if (waitForReply) {
                finishUploadAndWaitForReply();
            }
        } else if (!isRtcSessionActive) {
            showIdle();
        }
    }

    private void finishUploadAndWaitForReply() {
        ExternalAudioPusher pusher = audioPusher;
        RTCRoom activeRoom = rtcRoom;
        new Thread(() -> {
            if (pusher != null) {
                pusher.pushSilenceMillis(RTC_TAIL_SILENCE_MS);
            }
            if (activeRoom != null) {
                activeRoom.publishStreamAudio(false);
            }
        }, "RokidRtcTailSilence").start();

        scheduleRtcCleanup();
    }

    private void failRecording(String message) {
        isRecordingActive = false;
        isStartingSession = false;
        if (recorder != null) {
            recorder.release();
            recorder = null;
        }
        releaseRtcSession("record-failed", true);
        resumeAutoPhotoAfterRtc("record-failed");
        updateBossTalkButton(false);
        statusView.setText(R.string.record_failed);
        showDetail(message);
    }

    private void releaseRtcSession(String reason, boolean stopVoiceChat) {
        cancelPendingRtcCleanup();
        RtcSessionInfo sessionForStop;
        synchronized (rtcLock) {
            sessionForStop = currentRtcSession;
            releaseRtcSessionLocked(stopVoiceChat);
        }
        hideBossTtsOverlay();
        if (stopVoiceChat && sessionForStop != null && sessionForStop.taskId != null && !sessionForStop.taskId.isEmpty()) {
            stopVoiceChatAsync(sessionForStop);
        }
        Log.d(TAG, "releaseRtcSession: " + reason);
    }

    private void releaseRtcSessionLocked(boolean clearState) {
        audioPusher = null;
        rtcRoomJoined = false;
        if (rtcRoom != null) {
            try {
                rtcRoom.leaveRoom();
            } catch (Exception e) {
                Log.e(TAG, "leaveRoom failed", e);
            }
            try {
                rtcRoom.destroy();
            } catch (Exception e) {
                Log.e(TAG, "room destroy failed", e);
            }
            rtcRoom = null;
        }
        if (rtcEngine != null) {
            try {
                rtcEngine.stopAudioCapture();
            } catch (Exception e) {
                Log.e(TAG, "stopAudioCapture failed", e);
            }
            try {
                RTCEngine.destroyRTCEngine();
            } catch (Exception e) {
                Log.e(TAG, "destroy RTCEngine failed", e);
            }
            rtcEngine = null;
        }
        if (clearState) {
            currentRtcSession = null;
            isRtcSessionActive = false;
            currentRtcAgentUserId = "rokid-ai-bot-001";
            latestBossRtcSubtitle = "";
            latestUserRtcSubtitle = "";
            latestBinarySubtitlePayload = "";
            rtcExitMarkerHandled = false;
        }
    }

    private void scheduleRtcCleanup() {
        cancelPendingRtcCleanup();
        pendingRtcCleanup = () -> {
            if (!isRecordingActive && isRtcSessionActive) {
                releaseRtcSession("auto-cleanup", true);
                resumeAutoPhotoAfterRtc("auto-cleanup");
                updateBossTalkButton(false);
                statusView.setText(R.string.record_idle);
                showDetail("AI会话已结束");
            }
        };
        mainHandler.postDelayed(pendingRtcCleanup, RTC_CLEANUP_DELAY_MS);
    }

    private void cancelPendingRtcCleanup() {
        if (pendingRtcCleanup != null) {
            mainHandler.removeCallbacks(pendingRtcCleanup);
            pendingRtcCleanup = null;
        }
    }

    private void stopVoiceChatAsync(RtcSessionInfo session) {
        new Thread(() -> {
            try {
                String body = "{\"roomId\":\"" + escapeJson(session.roomId) + "\",\"taskId\":\"" + escapeJson(session.taskId) + "\"}";
                String response = httpPostJson(BACKEND_BASE_URL + "/voice/stop", body);
                Log.d(TAG, "StopVoiceChat response: " + response);
            } catch (Exception e) {
                Log.e(TAG, "StopVoiceChat failed", e);
            }
        }, "RokidStopVoiceChat").start();
    }

    private RtcSessionInfo requestRtcSession(String scenario) throws Exception {
        String timestamp = String.valueOf(System.currentTimeMillis());
        String roomId = "rokid-room-" + timestamp;
        String userId = "rokid-glasses-" + (timestamp.length() > 8 ? timestamp.substring(timestamp.length() - 8) : timestamp);
        String url = BACKEND_BASE_URL
                + "/rtc/session?room_id=" + encode(roomId)
                + "&user_id=" + encode(userId)
                + "&start_ai=1";
        String safeScenario = normalizeRtcScenario(scenario);
        if (!safeScenario.isEmpty()) {
            url += "&scenario=" + encode(safeScenario);
        }
        JSONObject root = new JSONObject(httpGet(url));
        if (!root.has("appId") || !root.has("token")) {
            throw new IllegalStateException(root.toString());
        }
        String taskId = "";
        String agentUserId = "rokid-ai-bot-001";
        JSONObject voiceChat = root.optJSONObject("voiceChat");
        if (voiceChat != null) {
            JSONObject request = voiceChat.optJSONObject("request");
            if (request != null) {
                taskId = request.optString("taskId", "");
                agentUserId = firstNonEmpty(request.optString("agentUserId", ""), agentUserId);
            }
            JSONObject response = voiceChat.optJSONObject("response");
            if (response != null) {
                JSONObject metadata = response.optJSONObject("ResponseMetadata");
                if (metadata != null && metadata.has("Error")) {
                    throw new IllegalStateException(metadata.getJSONObject("Error").toString());
                }
            }
        }
        return new RtcSessionInfo(
                root.getString("appId"),
                root.getString("roomId"),
                root.getString("userId"),
                root.getString("token"),
                taskId,
                agentUserId
        );
    }

    private static String httpGet(String urlString) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("GET");
        return readResponse(connection);
    }

    private static String httpPostJson(String urlString, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream outputStream = connection.getOutputStream()) {
            outputStream.write(bytes);
        }
        return readResponse(connection);
    }

    private static String uploadImageFile(File file, String category) throws Exception {
        String urlString = BACKEND_BASE_URL
                + "/images/upload?category=" + encode(category)
                + "&name=" + encode(file.getName());
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "image/jpeg");
        connection.setFixedLengthStreamingMode(file.length());
        try (InputStream inputStream = new java.io.FileInputStream(file);
             OutputStream outputStream = connection.getOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = inputStream.read(buffer)) >= 0) {
                outputStream.write(buffer, 0, read);
            }
        }
        return readResponse(connection);
    }

    private static String readResponse(HttpURLConnection connection) throws Exception {
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        byte[] data = readAll(stream);
        String text = new String(data, StandardCharsets.UTF_8);
        if (code < 200 || code >= 300) {
            throw new IllegalStateException("HTTP " + code + ": " + text);
        }
        return text;
    }

    private static byte[] readAll(InputStream inputStream) throws Exception {
        if (inputStream == null) {
            return new byte[0];
        }
        byte[] buffer = new byte[4096];
        int read;
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        while ((read = inputStream.read(buffer)) >= 0) {
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private static String encode(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8");
    }

    private static String escapeJson(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private void showIdle() {
        updateBossTalkButton(false);
        statusView.setText(R.string.record_idle);
        showDetail(isCameraUploadEnabled ? "单击语音 / 自动每10秒拍照上传" : "单击语音 / 摄像头等待后端配置");
        pathView.setText(BACKEND_BASE_URL);
        if (cameraStatusView != null) {
            if (isCameraUploadEnabled) {
                cameraStatusView.setText(isCameraReady ? R.string.camera_ready : R.string.camera_preparing);
            } else {
                showCameraDisabled(cameraConfigLoaded ? "后端配置 cameraEnabled=false" : "等待后端摄像头配置");
            }
        }
    }

    private void showDetail(String text) {
        detailView.setText(text);
    }

    private static final class RtcSessionInfo {
        final String appId;
        final String roomId;
        final String userId;
        final String token;
        final String taskId;
        final String agentUserId;

        RtcSessionInfo(String appId, String roomId, String userId, String token, String taskId, String agentUserId) {
            this.appId = appId;
            this.roomId = roomId;
            this.userId = userId;
            this.token = token;
            this.taskId = taskId;
            this.agentUserId = agentUserId;
        }
    }

    private static final class ExternalAudioPusher {
        private static final int INPUT_CHANNELS = 8;
        private static final int BYTES_PER_SAMPLE = 2;
        private static final int BYTES_PER_INPUT_FRAME = INPUT_CHANNELS * BYTES_PER_SAMPLE;
        private static final int TEN_MS_SAMPLES = 160;
        private static final int FIRST_PUSH_SAMPLES = TEN_MS_SAMPLES * 20;

        private final RTCEngine engine;
        private final byte[] pending = new byte[FIRST_PUSH_SAMPLES * BYTES_PER_SAMPLE];
        private int pendingSamples;
        private boolean firstPush = true;
        private long pushedFrames;
        private volatile boolean ready;

        ExternalAudioPusher(RTCEngine engine) {
            this.engine = engine;
        }

        void setReady(boolean ready) {
            this.ready = ready;
            if (ready) {
                flushReadyFrames();
            }
        }

        void offerEightChannelPcm16(byte[] input, int byteCount) {
            int frames = byteCount / BYTES_PER_INPUT_FRAME;
            for (int frame = 0; frame < frames; frame++) {
                int offset = frame * BYTES_PER_INPUT_FRAME;
                short ch0 = readLittleEndianShort(input, offset);
                short ch1 = readLittleEndianShort(input, offset + BYTES_PER_SAMPLE);
                short mono = (short) ((ch0 + ch1) / 2);
                appendMonoSample(mono);
            }
        }

        void pushSilenceMillis(int millis) {
            int samples = SAMPLE_RATE * millis / 1000;
            for (int i = 0; i < samples; i++) {
                appendMonoSample((short) 0);
            }
        }

        private void appendMonoSample(short sample) {
            if (!ready && pendingSamples >= FIRST_PUSH_SAMPLES) {
                return;
            }
            pending[pendingSamples * 2] = (byte) (sample & 0xff);
            pending[pendingSamples * 2 + 1] = (byte) ((sample >> 8) & 0xff);
            pendingSamples++;
            if (ready) {
                flushReadyFrames();
            }
        }

        private void flushReadyFrames() {
            if (!ready) {
                return;
            }
            int targetSamples = firstPush ? FIRST_PUSH_SAMPLES : TEN_MS_SAMPLES;
            while (pendingSamples >= targetSamples) {
                int byteCount = targetSamples * BYTES_PER_SAMPLE;
                byte[] frameBytes = new byte[byteCount];
                System.arraycopy(pending, 0, frameBytes, 0, byteCount);
                int remainingBytes = (pendingSamples - targetSamples) * BYTES_PER_SAMPLE;
                if (remainingBytes > 0) {
                    System.arraycopy(pending, byteCount, pending, 0, remainingBytes);
                }
                pendingSamples -= targetSamples;

                AudioFrame frame = new AudioFrame(
                        frameBytes,
                        targetSamples,
                        AudioSampleRate.AUDIO_SAMPLE_RATE_16000,
                        AudioChannel.AUDIO_CHANNEL_MONO
                );
                int ret = engine.pushExternalAudioFrame(frame);
                pushedFrames++;
                if (ret != 0 && pushedFrames % 50 == 1) {
                    Log.e(TAG, "pushExternalAudioFrame failed: " + ret);
                }
                firstPush = false;
                targetSamples = TEN_MS_SAMPLES;
            }
        }

        private static short readLittleEndianShort(byte[] buffer, int offset) {
            return (short) ((buffer[offset] & 0xff) | (buffer[offset + 1] << 8));
        }
    }
}
