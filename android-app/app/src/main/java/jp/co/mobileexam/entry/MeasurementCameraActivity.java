package jp.co.mobileexam.entry;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.media.MediaActionSound;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.activity.ComponentActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.util.ArrayList;
import java.util.concurrent.Executor;

public final class MeasurementCameraActivity extends ComponentActivity {
    public static final String EXTRA_PHOTO_PATH = "measurementPhotoPath";
    public static final String EXTRA_PHOTO_PATHS = "measurementPhotoPaths";
    private static final int BURST_COUNT = 3;
    public static final float GUIDE_LEFT = 0.08f;
    public static final float GUIDE_TOP = 0.18f;
    public static final float GUIDE_RIGHT = 0.92f;
    public static final float GUIDE_BOTTOM = 0.82f;

    private static final int CAMERA_PERMISSION_REQUEST = 501;
    private PreviewView previewView;
    private ImageButton captureButton;
    private TextView instruction;
    private ImageCapture imageCapture;
    private Executor mainExecutor;
    private MediaActionSound captureSound;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        mainExecutor = ContextCompat.getMainExecutor(this);
        captureSound = new MediaActionSound();
        captureSound.load(MediaActionSound.SHUTTER_CLICK);
        buildView();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }
    }

    private void buildView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.rgb(18, 23, 21));

        instruction = new TextView(this);
        instruction.setText("液晶全体を枠内に合わせてください\n撮影ボタンを押すと3枚連続で撮影します");
        instruction.setTextColor(Color.WHITE);
        instruction.setTextSize(17);
        instruction.setGravity(Gravity.CENTER);
        instruction.setPadding(dp(16), dp(16), dp(16), dp(14));
        root.addView(instruction, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        FrameLayout cameraFrame = new FrameLayout(this);
        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FIT_CENTER);
        cameraFrame.addView(previewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        cameraFrame.addView(new MeasurementGuideView(), new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        int availableWidth = getResources().getDisplayMetrics().widthPixels - dp(16);
        int availableHeight = getResources().getDisplayMetrics().heightPixels - dp(190);
        int cameraWidth = Math.min(availableWidth, Math.round(availableHeight * 3f / 4f));
        int cameraHeight = Math.round(cameraWidth * 4f / 3f);
        LinearLayout.LayoutParams cameraParams = new LinearLayout.LayoutParams(
            cameraWidth, cameraHeight);
        cameraParams.setMargins(dp(8), 0, dp(8), 0);
        root.addView(cameraFrame, cameraParams);

        captureButton = new ImageButton(this);
        captureButton.setImageResource(android.R.drawable.ic_menu_camera);
        captureButton.setContentDescription("撮影");
        captureButton.setTooltipText("撮影");
        captureButton.setColorFilter(Color.WHITE);
        captureButton.setBackgroundColor(Color.rgb(8, 117, 79));
        captureButton.setEnabled(false);
        captureButton.setOnClickListener(view -> capture());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(dp(76), dp(58));
        buttonParams.setMargins(0, dp(14), 0, dp(18));
        root.addView(captureButton, buttonParams);
        setContentView(root);
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview preview = new Preview.Builder().build();
                imageCapture = new ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());
                provider.unbindAll();
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA,
                    preview, imageCapture);
                captureButton.setEnabled(true);
            } catch (Exception error) {
                showFailure("カメラを開始できませんでした。");
            }
        }, mainExecutor);
    }

    private void capture() {
        if (imageCapture == null) return;
        captureButton.setEnabled(false);
        instruction.setText("撮影中　数字を枠に入れたままにしてください\n3枚を連続で撮影しています");
        playCaptureStartTone();
        captureSequence(new ArrayList<>(), 0);
    }

    private void playCaptureStartTone() {
        captureSound.play(MediaActionSound.SHUTTER_CLICK);
        captureButton.performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM);
    }

    @Override protected void onDestroy() {
        if (captureSound != null) captureSound.release();
        super.onDestroy();
    }

    private void captureSequence(ArrayList<String> paths, int index) {
        try {
            File directory = new File(getCacheDir(), "measurement-photos");
            if (!directory.exists() && !directory.mkdirs()) throw new Exception();
            File photo = File.createTempFile("ad6351-", ".jpg", directory);
            ImageCapture.OutputFileOptions options =
                new ImageCapture.OutputFileOptions.Builder(photo).build();
            imageCapture.takePicture(options, mainExecutor,
                new ImageCapture.OnImageSavedCallback() {
                    @Override public void onImageSaved(
                        @NonNull ImageCapture.OutputFileResults output) {
                        paths.add(photo.getAbsolutePath());
                        instruction.setText("撮影中　数字を枠に入れたままにしてください\n"
                            + paths.size() + " / " + BURST_COUNT + " 枚");
                        if (paths.size() >= BURST_COUNT) {
                            setResult(RESULT_OK, new Intent()
                                .putExtra(EXTRA_PHOTO_PATH, paths.get(0))
                                .putStringArrayListExtra(EXTRA_PHOTO_PATHS, paths));
                            finish();
                            return;
                        }
                        captureButton.postDelayed(() -> captureSequence(paths, index + 1), 250);
                    }

                    @Override public void onError(@NonNull ImageCaptureException error) {
                        if (photo.exists()) photo.delete();
                        deletePhotos(paths);
                        captureButton.setEnabled(true);
                        instruction.setText("液晶全体を枠内に合わせてください\n撮影ボタンを押すと3枚連続で撮影します");
                        showFailure("写真を保存できませんでした。");
                    }
                });
        } catch (Exception error) {
            captureButton.setEnabled(true);
            instruction.setText("液晶全体を枠内に合わせてください\n撮影ボタンを押すと3枚連続で撮影します");
            showFailure("撮影用ファイルを準備できませんでした。");
        }
    }

    private void deletePhotos(ArrayList<String> paths) {
        for (String path : paths) {
            File photo = new File(path);
            if (photo.exists()) photo.delete();
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode,
                                                      @NonNull String[] permissions,
                                                      @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CAMERA_PERMISSION_REQUEST && results.length > 0
            && results[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            showFailure("カメラの使用が許可されていません。");
            finish();
        }
    }

    private void showFailure(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class MeasurementGuideView extends View {
        private final Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);

        MeasurementGuideView() {
            super(MeasurementCameraActivity.this);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            border.setStyle(Paint.Style.STROKE);
            border.setStrokeWidth(dp(3));
            border.setColor(Color.rgb(72, 238, 165));
            border.setShadowLayer(dp(2), 0, 0, Color.BLACK);
            label.setColor(Color.WHITE);
            label.setTextSize(dp(16));
            label.setFakeBoldText(true);
            label.setShadowLayer(dp(3), 0, 0, Color.BLACK);
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float left = getWidth() * GUIDE_LEFT;
            float right = getWidth() * GUIDE_RIGHT;
            float top = getHeight() * GUIDE_TOP;
            float bottom = getHeight() * GUIDE_BOTTOM;
            float split = top + (bottom - top) * 0.52f;
            canvas.drawRect(left, top, right, bottom, border);
            canvas.drawLine(left, split, right, split, border);
            canvas.drawText("身長の数字", left + dp(10), top + dp(24), label);
            canvas.drawText("体重の数字", left + dp(10), split + dp(24), label);
        }
    }
}
