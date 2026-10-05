package jp.co.mobileexam.entry;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;

import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.CameraPreview;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;

public class RetryBarcodeActivity extends Activity {
    public static final String EXTRA_CAMERA_ERROR = "jp.co.mobileexam.entry.CAMERA_ERROR";
    private static final int MAX_CAMERA_RETRIES = 2;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private DecoratedBarcodeView barcodeView;
    private int cameraRetries;
    private boolean active;
    private boolean retryScheduled;

    private final BarcodeCallback callback = new BarcodeCallback() {
        @Override public void barcodeResult(BarcodeResult result) {
            if (result == null || result.getText() == null) return;
            Intent data = new Intent();
            data.putExtra(Intents.Scan.RESULT, result.getText());
            data.putExtra(Intents.Scan.RESULT_FORMAT, result.getBarcodeFormat().toString());
            setResult(RESULT_OK, data);
            finish();
        }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        barcodeView = new DecoratedBarcodeView(this);
        barcodeView.initializeFromIntent(getIntent());
        barcodeView.getBarcodeView().addStateListener(new CameraPreview.StateListener() {
            @Override public void previewSized() { }
            @Override public void previewStarted() {
                cameraRetries = 0;
                retryScheduled = false;
            }
            @Override public void previewStopped() { }
            @Override public void cameraClosed() { }
            @Override public void cameraError(Exception error) { retryCamera(error); }
        });
        barcodeView.decodeSingle(callback);
        setContentView(barcodeView);
    }

    @Override protected void onResume() {
        super.onResume();
        active = true;
        handler.postDelayed(barcodeView::resume, 250L);
    }

    @Override protected void onPause() {
        active = false;
        handler.removeCallbacksAndMessages(null);
        barcodeView.pause();
        super.onPause();
    }

    private void retryCamera(Exception error) {
        if (!active || retryScheduled) return;
        if (cameraRetries >= MAX_CAMERA_RETRIES) {
            Intent data = new Intent();
            String reason = error == null ? "" : error.getMessage();
            data.putExtra(EXTRA_CAMERA_ERROR,
                "カメラを開けませんでした。ほかのカメラアプリを終了して再試行してください。" +
                (reason == null || reason.isEmpty() ? "" : "（" + reason + "）"));
            setResult(RESULT_CANCELED, data);
            finish();
            return;
        }
        cameraRetries++;
        retryScheduled = true;
        barcodeView.pause();
        handler.postDelayed(() -> {
            if (!active) return;
            retryScheduled = false;
            barcodeView.resume();
            barcodeView.decodeSingle(callback);
        }, 900L);
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        return barcodeView.onKeyDown(keyCode, event) || super.onKeyDown(keyCode, event);
    }
}
