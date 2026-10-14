package jp.co.mobileexam.entry;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.net.Uri;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.NfcF;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.FileProvider;
import androidx.exifinterface.media.ExifInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.CRC32;

public class MainActivity extends Activity implements NfcAdapter.ReaderCallback {
    private static final String TAG = "MobileExamCamera";
    private static final String APP_URL = "https://mobile-exam-entry-b6w9-z574.onrender.com/";
    private static final String APP_HOST = "mobile-exam-entry-b6w9-z574.onrender.com";
    private static final int BLOCK_COUNT = 14;
    private static final int SLOT_BLOCKS = 7;
    private static final int MAX_PAYLOAD = 96;
    private static final int MEASUREMENT_CAMERA_REQUEST = 4201;
    private static final Pattern DECIMAL_VALUE = Pattern.compile("(?<![0-9])([0-9]{1,4}(?:[.,][0-9])?)(?![0-9])");
    private static final byte[] MAGIC = new byte[]{0x4d, 0x45, 0x58, 0x31};
    private WebView webView;
    private NfcAdapter nfcAdapter;
    private volatile Tag currentTag;
    private SharedPreferences bindings;
    private SharedPreferences deviceSettings;
    private File measurementPhoto;
    private ArrayList<File> measurementBatchFiles;
    private final ArrayList<JSONObject> measurementBatchResults = new ArrayList<>();
    private int measurementBatchIndex;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        bindings = getSharedPreferences("felica_bindings", MODE_PRIVATE);
        deviceSettings = getSharedPreferences("device_settings", MODE_PRIVATE);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        if (android.os.Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        webView.addJavascriptInterface(new FelicaBridge(), "AndroidFelica");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !("https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost()));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean trusted = APP_HOST.equals(request.getOrigin().getHost());
                    boolean cameraOnly = Arrays.stream(request.getResources()).allMatch(PermissionRequest.RESOURCE_VIDEO_CAPTURE::equals);
                    if (trusted && cameraOnly) request.grant(request.getResources()); else request.deny();
                });
            }
        });
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 10);
        }
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                this::handleBackNavigation
            );
        }
        webView.loadUrl(APP_URL);
    }

    @Override protected void onResume() {
        super.onResume();
        if (nfcAdapter != null) nfcAdapter.enableReaderMode(this, this,
            NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK |
                NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS, null);
    }

    @Override protected void onPause() {
        currentTag = null;
        if (nfcAdapter != null) nfcAdapter.disableReaderMode(this);
        super.onPause();
    }

    @Override public void onTagDiscovered(Tag tag) {
        currentTag = tag;
        String idm = hex(tag.getId());
        String script = "window.dispatchEvent(new CustomEvent('android-felica-tag',{detail:{idm:'" + idm + "'}}));";
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private final class FelicaBridge {
        @JavascriptInterface public String request(String path, String bodyJson) {
            try {
                JSONObject body = bodyJson == null || bodyJson.isEmpty() ? new JSONObject() : new JSONObject(bodyJson);
                switch (path) {
                    case "/capabilities":
                        return ok().put("barcodeCamera", true).put("measurementCamera", true).put("nfc", nfcAdapter != null).toString();
                    case "/health":
                        if (nfcAdapter == null) throw new Exception("この端末はNFCに対応していません。");
                        if (!nfcAdapter.isEnabled()) throw new Exception("NFCが無効です。端末のNFCを有効にしてください。");
                        return ok().put("mode", "android-nfc").toString();
                    case "/card/read": case "/card/backup": return readCard().toString();
                    case "/card/write": return writeCard(body).toString();
                    case "/binding/lookup": return lookupBinding(body.optString("idm")).toString();
                    case "/binding/save": return saveBinding(body).toString();
                    case "/feedback/get": return ok().put("mode", feedbackMode()).toString();
                    case "/feedback/set": return saveFeedbackMode(body.optString("mode")).toString();
                    case "/feedback/play": playCardFeedback(body.optString("outcome")); return ok().toString();
                    case "/barcode/scan": startBarcodeScan(); return ok().put("started", true).toString();
                    case "/measurement/scan": startMeasurementScan(); return ok().put("started", true).toString();
                    default: throw new Exception("未対応のFeliCa操作です: " + path);
                }
            } catch (Exception error) { return failure(error).toString(); }
        }
    }

    private void startBarcodeScan() {
        Log.i(TAG, "Barcode scan requested");
        runOnUiThread(() -> {
            try {
                IntentIntegrator scanner = new IntentIntegrator(this);
                scanner.setDesiredBarcodeFormats(IntentIntegrator.ALL_CODE_TYPES);
                scanner.setPrompt("受診票の個人番号バーコードを枠内に合わせてください");
                scanner.setBeepEnabled(true);
                scanner.setBarcodeImageEnabled(false);
                scanner.setOrientationLocked(true);
                scanner.setCaptureActivity(RetryBarcodeActivity.class);
                Log.i(TAG, "Starting CaptureActivity");
                scanner.initiateScan();
            } catch (RuntimeException error) {
                Log.e(TAG, "Unable to start CaptureActivity", error);
                dispatchBarcodeEvent("android-barcode-error", error.getMessage(), null);
            }
        });
    }

    private void startMeasurementScan() {
        runOnUiThread(() -> {
            try {
                Intent intent = new Intent(this, MeasurementCameraActivity.class);
                startActivityForResult(intent, MEASUREMENT_CAMERA_REQUEST);
            } catch (Exception error) {
                deleteMeasurementPhoto();
                dispatchMeasurementError(error.getMessage());
            }
        });
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == MEASUREMENT_CAMERA_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> paths = data.getStringArrayListExtra(
                    MeasurementCameraActivity.EXTRA_PHOTO_PATHS);
                measurementBatchFiles = new ArrayList<>();
                if (paths != null) {
                    for (String path : paths) if (path != null) measurementBatchFiles.add(new File(path));
                }
                if (measurementBatchFiles.isEmpty()) {
                    String path = data.getStringExtra(MeasurementCameraActivity.EXTRA_PHOTO_PATH);
                    if (path != null) measurementBatchFiles.add(new File(path));
                }
                measurementBatchResults.clear();
                measurementBatchIndex = 0;
                measurementPhoto = measurementBatchFiles.isEmpty() ? null : measurementBatchFiles.get(0);
                recognizeMeasurementPhoto();
            } else {
                deleteMeasurementPhoto();
            }
            return;
        }
        Log.i(TAG, "Scanner result request=" + requestCode + " result=" + resultCode);
        if (data != null && data.hasExtra(RetryBarcodeActivity.EXTRA_CAMERA_ERROR)) {
            dispatchBarcodeEvent("android-barcode-error",
                data.getStringExtra(RetryBarcodeActivity.EXTRA_CAMERA_ERROR), null);
            return;
        }
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (result == null) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (result.getContents() == null) {
            dispatchBarcodeEvent("android-barcode-cancelled", null, null);
            return;
        }
        dispatchBarcodeEvent("android-barcode-scanned", result.getContents(), result.getFormatName());
    }

    private void recognizeMeasurementPhoto() {
        File photo = measurementPhoto;
        if (photo == null || !photo.isFile()) {
            completeMeasurementRecognition(null);
            return;
        }
        try {
            Bitmap decoded = decodeOrientedBitmap(photo);
            if (decoded == null) throw new Exception("撮影画像を読み込めませんでした。");
            Bitmap guided = cropMeasurementGuide(decoded);
            if (guided != decoded) decoded.recycle();
            final Bitmap original = guided;
            Bitmap enhanced = enhanceMeasurementBitmap(original);
            TextRecognizer latinRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            TextRecognizer japaneseRecognizer = TextRecognition.getClient(new JapaneseTextRecognizerOptions.Builder().build());
            latinRecognizer.process(InputImage.fromBitmap(original, 0)).addOnCompleteListener(firstTask ->
                latinRecognizer.process(InputImage.fromBitmap(enhanced, 0)).addOnCompleteListener(secondTask ->
                    japaneseRecognizer.process(InputImage.fromBitmap(original, 0)).addOnCompleteListener(thirdTask -> {
                        Text firstText = firstTask.isSuccessful() ? firstTask.getResult() : null;
                        Text secondText = secondTask.isSuccessful() ? secondTask.getResult() : null;
                        Text thirdText = thirdTask.isSuccessful() ? thirdTask.getResult() : null;
                        Bitmap heightRow = createGuidedNumberRow(original, true);
                        Bitmap weightRow = createGuidedNumberRow(original, false);
                        latinRecognizer.process(InputImage.fromBitmap(heightRow, 0)).addOnCompleteListener(heightTask ->
                            latinRecognizer.process(InputImage.fromBitmap(weightRow, 0)).addOnCompleteListener(weightTask -> {
                                Text heightText = heightTask.isSuccessful() ? heightTask.getResult() : null;
                                Text weightText = weightTask.isSuccessful() ? weightTask.getResult() : null;
                                Measurement guidedMeasurement = decodeGuidedMeasurement(heightText, weightText);
                                heightRow.recycle();
                                weightRow.recycle();
                                continueMeasurementRecognition(original, enhanced, latinRecognizer, japaneseRecognizer,
                                    guidedMeasurement, firstText, secondText, thirdText, heightText, weightText);
                            }));
                    })));
        } catch (Exception error) {
            deleteMeasurementPhoto();
            completeMeasurementRecognition(null);
        }
    }

    private void continueMeasurementRecognition(Bitmap original, Bitmap enhanced,
                                                  TextRecognizer latinRecognizer,
                                                  TextRecognizer japaneseRecognizer,
                                                  Measurement guidedMeasurement,
                                                  Text firstText, Text secondText, Text thirdText,
                                                  Text heightText, Text weightText) {
        Measurement decodedSevenSegment = decodeSevenSegmentMeasurement(enhanced, secondText);
        if (decodedSevenSegment == null) decodedSevenSegment = decodeSevenSegmentMeasurement(original, thirdText);
        final Measurement sevenSegment = guidedMeasurement != null ? guidedMeasurement : decodedSevenSegment;
        Bitmap focused = createFocusedMeasurementBitmap(enhanced, secondText);
        if (focused == null) focused = createFocusedMeasurementBitmap(original, thirdText);
        if (focused == null) {
            finishMeasurementRecognition(sevenSegment, firstText, secondText, thirdText, heightText, weightText);
            closeMeasurementRecognition(latinRecognizer, japaneseRecognizer, original, enhanced, null);
            return;
        }
        Bitmap finalFocused = focused;
        Bitmap thresholded = thresholdMeasurementBitmap(finalFocused, false);
        Bitmap inverted = thresholdMeasurementBitmap(finalFocused, true);
        latinRecognizer.process(InputImage.fromBitmap(finalFocused, 0)).addOnCompleteListener(fourthTask ->
            japaneseRecognizer.process(InputImage.fromBitmap(finalFocused, 0)).addOnCompleteListener(fifthTask -> {
                Text fourthText = fourthTask.isSuccessful() ? fourthTask.getResult() : null;
                Text fifthText = fifthTask.isSuccessful() ? fifthTask.getResult() : null;
                latinRecognizer.process(InputImage.fromBitmap(thresholded, 0)).addOnCompleteListener(sixthTask ->
                    latinRecognizer.process(InputImage.fromBitmap(inverted, 0)).addOnCompleteListener(seventhTask -> {
                        Text sixthText = sixthTask.isSuccessful() ? sixthTask.getResult() : null;
                        Text seventhText = seventhTask.isSuccessful() ? seventhTask.getResult() : null;
                        finishMeasurementRecognition(sevenSegment, firstText, secondText, thirdText,
                            heightText, weightText, fourthText, fifthText, sixthText, seventhText);
                        thresholded.recycle();
                        inverted.recycle();
                        closeMeasurementRecognition(latinRecognizer, japaneseRecognizer, original,
                            enhanced, finalFocused);
                    }));
            }));
    }

    private Bitmap createGuidedNumberRow(Bitmap source, boolean height) {
        int left = Math.round(source.getWidth() * 0.18f);
        int right = Math.round(source.getWidth() * 0.96f);
        int top = Math.round(source.getHeight() * (height ? 0.04f : 0.48f));
        int bottom = Math.round(source.getHeight() * (height ? 0.54f : 0.96f));
        Bitmap crop = Bitmap.createBitmap(source, left, top, right - left, bottom - top);
        Bitmap enhanced = enhanceMeasurementBitmap(crop);
        if (enhanced != crop) crop.recycle();
        Log.i(TAG, "Measurement guided row=" + (height ? "height" : "weight")
            + " size=" + enhanced.getWidth() + "x" + enhanced.getHeight());
        return enhanced;
    }

    private Measurement decodeGuidedMeasurement(Text heightText, Text weightText) {
        Double height = decodeGuidedValue(heightText, true);
        Double weight = decodeGuidedValue(weightText, false);
        Log.i(TAG, "Measurement guided OCR height=" + summarizeRecognizedText(
            heightText == null ? "" : heightText.getText()) + " weight=" + summarizeRecognizedText(
            weightText == null ? "" : weightText.getText()));
        if (height == null || weight == null) return null;
        Log.i(TAG, "Measurement guided value=" + formatMeasurement(height) + "cm "
            + formatMeasurement(weight) + "kg");
        return new Measurement(height, weight);
    }

    private Double decodeGuidedValue(Text text, boolean height) {
        if (text == null) return null;
        String numericArea = text.getText().replaceAll("(?i)(cm|kg|ka|k9|kq)", " ");
        Matcher matcher = Pattern.compile("[A-Za-z0-9|.,]{3,7}").matcher(numericArea);
        while (matcher.find()) {
            Double value = decodeAd6351Token(matcher.group(), height);
            if (value != null && (height ? validHeight(value) : validWeight(value))) return value;
        }
        return null;
    }

    private Bitmap cropMeasurementGuide(Bitmap source) {
        int left = Math.round(source.getWidth() * MeasurementCameraActivity.GUIDE_LEFT);
        int top = Math.round(source.getHeight() * MeasurementCameraActivity.GUIDE_TOP);
        int right = Math.round(source.getWidth() * MeasurementCameraActivity.GUIDE_RIGHT);
        int bottom = Math.round(source.getHeight() * MeasurementCameraActivity.GUIDE_BOTTOM);
        left = Math.max(0, Math.min(left, source.getWidth() - 2));
        top = Math.max(0, Math.min(top, source.getHeight() - 2));
        right = Math.max(left + 1, Math.min(right, source.getWidth()));
        bottom = Math.max(top + 1, Math.min(bottom, source.getHeight()));
        Log.i(TAG, "Measurement guide crop=" + left + "," + top + "-" + right + "," + bottom);
        return Bitmap.createBitmap(source, left, top, right - left, bottom - top);
    }

    private Bitmap decodeOrientedBitmap(File photo) throws Exception {
        Bitmap decoded = BitmapFactory.decodeFile(photo.getAbsolutePath());
        if (decoded == null) return null;
        int orientation = new ExifInterface(photo).getAttributeInt(
            ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90: matrix.postRotate(90); break;
            case ExifInterface.ORIENTATION_ROTATE_180: matrix.postRotate(180); break;
            case ExifInterface.ORIENTATION_ROTATE_270: matrix.postRotate(270); break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.preScale(-1, 1); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.preScale(1, -1); break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.preScale(-1, 1);
                matrix.postRotate(270);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.preScale(-1, 1);
                matrix.postRotate(90);
                break;
            default: return decoded;
        }
        Bitmap oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
        if (oriented != decoded) decoded.recycle();
        return oriented;
    }

    private Bitmap enhanceMeasurementBitmap(Bitmap source) {
        int targetWidth = Math.min(source.getWidth(), 1600);
        int targetHeight = Math.max(1, Math.round(source.getHeight() * (targetWidth / (float) source.getWidth())));
        Bitmap scaled = Bitmap.createScaledBitmap(source, targetWidth, targetHeight, true);
        Bitmap enhanced = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
        int[] pixels = new int[targetWidth * targetHeight];
        scaled.getPixels(pixels, 0, targetWidth, 0, 0, targetWidth, targetHeight);
        for (int index = 0; index < pixels.length; index++) {
            int color = pixels[index];
            int gray = Math.round(Color.red(color) * 0.299f + Color.green(color) * 0.587f + Color.blue(color) * 0.114f);
            gray = Math.max(0, Math.min(255, Math.round((gray - 128) * 1.8f + 128)));
            pixels[index] = Color.rgb(gray, gray, gray);
        }
        enhanced.setPixels(pixels, 0, targetWidth, 0, 0, targetWidth, targetHeight);
        if (scaled != source) scaled.recycle();
        return enhanced;
    }

    private Bitmap thresholdMeasurementBitmap(Bitmap source, boolean invert) {
        int width = source.getWidth();
        int height = source.getHeight();
        int[] pixels = new int[width * height];
        int[] histogram = new int[256];
        source.getPixels(pixels, 0, width, 0, 0, width, height);
        for (int color : pixels) {
            int gray = Math.round(Color.red(color) * 0.299f + Color.green(color) * 0.587f
                + Color.blue(color) * 0.114f);
            histogram[gray]++;
        }

        long total = pixels.length;
        long weightedTotal = 0;
        for (int level = 0; level < histogram.length; level++) weightedTotal += (long) level * histogram[level];
        long backgroundWeight = 0;
        long backgroundTotal = 0;
        double largestVariance = -1;
        int threshold = 160;
        for (int level = 0; level < histogram.length; level++) {
            backgroundWeight += histogram[level];
            if (backgroundWeight == 0) continue;
            long foregroundWeight = total - backgroundWeight;
            if (foregroundWeight == 0) break;
            backgroundTotal += (long) level * histogram[level];
            double backgroundMean = backgroundTotal / (double) backgroundWeight;
            double foregroundMean = (weightedTotal - backgroundTotal) / (double) foregroundWeight;
            double variance = (double) backgroundWeight * foregroundWeight
                * (backgroundMean - foregroundMean) * (backgroundMean - foregroundMean);
            if (variance > largestVariance) {
                largestVariance = variance;
                threshold = level;
            }
        }

        for (int index = 0; index < pixels.length; index++) {
            int color = pixels[index];
            int gray = Math.round(Color.red(color) * 0.299f + Color.green(color) * 0.587f
                + Color.blue(color) * 0.114f);
            boolean dark = gray <= threshold;
            int value = dark ^ invert ? 0 : 255;
            pixels[index] = Color.rgb(value, value, value);
        }
        Bitmap result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        result.setPixels(pixels, 0, width, 0, 0, width, height);
        Log.i(TAG, "Measurement threshold=" + threshold + " invert=" + invert);
        return result;
    }

    private Bitmap createFocusedMeasurementBitmap(Bitmap source, Text text) {
        if (text == null) return null;
        Rect centimeter = null;
        Rect kilogram = null;
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                if (box == null) continue;
                String normalized = normalizeOcrText(line.getText()).toLowerCase(Locale.ROOT).replace(" ", "");
                if (normalized.contains("cm")) centimeter = box;
                if (normalized.contains("kg") || normalized.contains("k9") || normalized.contains("kq")) kilogram = box;
            }
        }
        if (centimeter == null || kilogram == null) return null;
        int rowGap = Math.abs(kilogram.centerY() - centimeter.centerY());
        if (rowGap < 20) return null;
        int left = Math.max(0, Math.min(centimeter.left, kilogram.left) - Math.round(rowGap * 2.8f));
        int right = Math.min(source.getWidth(), Math.max(centimeter.right, kilogram.right) + Math.round(rowGap * 0.35f));
        int top = Math.max(0, Math.min(centimeter.top, kilogram.top) - Math.round(rowGap * 0.7f));
        int bottom = Math.min(source.getHeight(), Math.max(centimeter.bottom, kilogram.bottom) + Math.round(rowGap * 0.7f));
        if (right - left < 80 || bottom - top < 80) return null;
        Bitmap crop = Bitmap.createBitmap(source, left, top, right - left, bottom - top);
        int targetWidth = Math.max(1200, Math.min(2000, crop.getWidth() * 2));
        int targetHeight = Math.max(1, Math.round(crop.getHeight() * (targetWidth / (float) crop.getWidth())));
        Bitmap focused = Bitmap.createScaledBitmap(crop, targetWidth, targetHeight, true);
        if (focused != crop) crop.recycle();
        Log.i(TAG, "Measurement focus crop=" + left + "," + top + "-" + right + "," + bottom
            + " scaled=" + targetWidth + "x" + targetHeight);
        return focused;
    }

    private Measurement decodeSevenSegmentMeasurement(Bitmap source, Text text) {
        if (source == null || text == null) return null;
        Rect centimeter = findUnitElement(text, "cm");
        Rect kilogram = findUnitElement(text, "kg", "k9", "kq");
        if (centimeter == null || kilogram == null) return null;
        int rowGap = Math.abs(kilogram.centerY() - centimeter.centerY());
        if (rowGap < 30) return null;
        Double height = decodeSevenSegmentRow(source, centimeter, rowGap, 4, 3.65f);
        Double weight = decodeSevenSegmentRow(source, kilogram, rowGap, 3, 2.75f);
        if (height == null || weight == null || !validHeight(height) || !validWeight(weight)) return null;
        Log.i(TAG, "AD-6351 seven-segment=" + formatMeasurement(height) + "cm "
            + formatMeasurement(weight) + "kg");
        return new Measurement(height, weight);
    }

    private Rect findUnitElement(Text text, String... units) {
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                for (Text.Element element : line.getElements()) {
                    String value = normalizeOcrText(element.getText()).toLowerCase(Locale.ROOT)
                        .replace(" ", "");
                    for (String unit : units) {
                        if (value.contains(unit)) return element.getBoundingBox();
                    }
                }
            }
        }
        return null;
    }

    private Double decodeSevenSegmentRow(Bitmap source, Rect unit, int rowGap,
                                         int digitCount, float rowWidthFactor) {
        int right = Math.min(source.getWidth(), unit.left - Math.round(rowGap * 0.04f));
        int left = Math.max(0, right - Math.round(rowGap * rowWidthFactor));
        int centerY = unit.centerY() - Math.round(rowGap * 0.05f);
        int top = Math.max(0, centerY - Math.round(rowGap * 0.43f));
        int bottom = Math.min(source.getHeight(), centerY + Math.round(rowGap * 0.43f));
        if (right - left < digitCount * 20 || bottom - top < 40) return null;

        int threshold = otsuThreshold(source, left, top, right, bottom);
        float slotWidth = (right - left) / (float) digitCount;
        StringBuilder digits = new StringBuilder();
        for (int index = 0; index < digitCount; index++) {
            int slotLeft = Math.round(left + slotWidth * index);
            int slotRight = Math.round(left + slotWidth * (index + 1));
            int digit = classifySevenSegmentDigit(source, slotLeft, top, slotRight, bottom, threshold);
            if (digit < 0) return null;
            digits.append(digit);
        }
        try {
            return Double.parseDouble(digits.substring(0, digitCount - 1) + "."
                + digits.substring(digitCount - 1));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private int otsuThreshold(Bitmap source, int left, int top, int right, int bottom) {
        int[] histogram = new int[256];
        for (int y = top; y < bottom; y += 2) {
            for (int x = left; x < right; x += 2) histogram[gray(source.getPixel(x, y))]++;
        }
        long total = 0;
        long weightedTotal = 0;
        for (int value = 0; value < histogram.length; value++) {
            total += histogram[value];
            weightedTotal += (long) value * histogram[value];
        }
        long backgroundWeight = 0;
        long backgroundTotal = 0;
        double largestVariance = -1;
        int threshold = 128;
        for (int value = 0; value < histogram.length; value++) {
            backgroundWeight += histogram[value];
            backgroundTotal += (long) value * histogram[value];
            long foregroundWeight = total - backgroundWeight;
            if (backgroundWeight == 0 || foregroundWeight == 0) continue;
            double backgroundMean = backgroundTotal / (double) backgroundWeight;
            double foregroundMean = (weightedTotal - backgroundTotal) / (double) foregroundWeight;
            double variance = (double) backgroundWeight * foregroundWeight
                * Math.pow(backgroundMean - foregroundMean, 2);
            if (variance > largestVariance) {
                largestVariance = variance;
                threshold = value;
            }
        }
        return threshold;
    }

    private int classifySevenSegmentDigit(Bitmap source, int left, int top, int right,
                                          int bottom, int threshold) {
        float[][] regions = {
            {0.23f, 0.03f, 0.77f, 0.17f}, // top
            {0.72f, 0.14f, 0.94f, 0.48f}, // upper right
            {0.72f, 0.52f, 0.94f, 0.86f}, // lower right
            {0.23f, 0.83f, 0.77f, 0.97f}, // bottom
            {0.06f, 0.52f, 0.28f, 0.86f}, // lower left
            {0.06f, 0.14f, 0.28f, 0.48f}, // upper left
            {0.23f, 0.43f, 0.77f, 0.57f}  // middle
        };
        double[] darkness = new double[7];
        for (int segment = 0; segment < regions.length; segment++) {
            float[] region = regions[segment];
            darkness[segment] = darkRatio(source,
                Math.round(left + (right - left) * region[0]),
                Math.round(top + (bottom - top) * region[1]),
                Math.round(left + (right - left) * region[2]),
                Math.round(top + (bottom - top) * region[3]), threshold);
        }
        int[] masks = {0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f};
        int bestDigit = -1;
        double bestScore = -1;
        double secondScore = -1;
        for (int digit = 0; digit < masks.length; digit++) {
            double score = 0;
            for (int segment = 0; segment < darkness.length; segment++) {
                boolean expected = (masks[digit] & (1 << segment)) != 0;
                score += expected ? darkness[segment] : 1.0 - darkness[segment];
            }
            score /= darkness.length;
            if (score > bestScore) {
                secondScore = bestScore;
                bestScore = score;
                bestDigit = digit;
            } else if (score > secondScore) {
                secondScore = score;
            }
        }
        return bestScore >= 0.60 && bestScore - secondScore >= 0.025 ? bestDigit : -1;
    }

    private double darkRatio(Bitmap source, int left, int top, int right, int bottom, int threshold) {
        int dark = 0;
        int count = 0;
        left = Math.max(0, left);
        top = Math.max(0, top);
        right = Math.min(source.getWidth(), right);
        bottom = Math.min(source.getHeight(), bottom);
        for (int y = top; y < bottom; y += 2) {
            for (int x = left; x < right; x += 2) {
                if (gray(source.getPixel(x, y)) <= threshold) dark++;
                count++;
            }
        }
        return count == 0 ? 0 : dark / (double) count;
    }

    private int gray(int color) {
        return Math.round(Color.red(color) * 0.299f + Color.green(color) * 0.587f
            + Color.blue(color) * 0.114f);
    }

    private void finishMeasurementRecognition(Measurement sevenSegment, Text... recognizedTexts) {
        try {
            List<Measurement> measurements = new ArrayList<>();
            List<Measurement> trustedMeasurements = new ArrayList<>();
            for (int index = 0; index < recognizedTexts.length; index++) {
                Text text = recognizedTexts[index];
                String summary = summarizeRecognizedText(text == null ? "" : text.getText());
                Log.i(TAG, "Measurement OCR pass" + (index + 1) + "=" + summary);
                Measurement candidate = text == null ? null : extractMeasurement(text);
                if (candidate != null) {
                    measurements.add(candidate);
                    // The last two passes are thresholded variants. They are useful hints, but a
                    // single result from them is too easy to mistake for a valid seven-segment value.
                    if (index < 5) trustedMeasurements.add(candidate);
                }
            }

            Measurement correctedDisplay = extractAd6351DisplayPattern(recognizedTexts);
            // A complete OCR pair from the display is more reliable than the geometric
            // seven-segment fallback, especially when a monitor introduces moire.
            if (correctedDisplay != null) {
                Log.i(TAG, "Measurement selected source=display OCR value="
                    + formatMeasurement(correctedDisplay.height) + "cm "
                    + formatMeasurement(correctedDisplay.weight) + "kg");
                sevenSegment = correctedDisplay;
            }

            Measurement measurement = findRepeatedMeasurement(trustedMeasurements);
            if (measurement != null && sevenSegment != null && !sameMeasurement(measurement, sevenSegment)) {
                measurement = null;
            }
            if (measurement != null) {
                JSONObject detail = new JSONObject()
                    .put("height", formatMeasurement(measurement.height))
                    .put("weight", formatMeasurement(measurement.weight));
                completeMeasurementRecognition(detail);
                return;
            }

            int trustedCount = Math.min(5, recognizedTexts.length);
            PartialMeasurement partial = extractPartialMeasurement(
                Arrays.copyOfRange(recognizedTexts, 0, trustedCount));
            JSONObject detail = new JSONObject().put("requiresReview", true);
            if (sevenSegment != null) {
                detail.put("height", formatMeasurement(sevenSegment.height));
                detail.put("weight", formatMeasurement(sevenSegment.weight));
            } else {
                if (partial.height != null) detail.put("height", formatMeasurement(partial.height));
                if (partial.weight != null) detail.put("weight", formatMeasurement(partial.weight));
            }
            JSONArray candidates = new JSONArray();
            List<String> uniqueCandidates = new ArrayList<>();
            if (sevenSegment != null) {
                String label = formatMeasurement(sevenSegment.height) + "cm / "
                    + formatMeasurement(sevenSegment.weight) + "kg（7セグ判定）";
                uniqueCandidates.add(label);
                candidates.put(label);
            }
            for (Measurement candidate : measurements) {
                String label = formatMeasurement(candidate.height) + "cm / "
                    + formatMeasurement(candidate.weight) + "kg";
                if (!uniqueCandidates.contains(label)) {
                    uniqueCandidates.add(label);
                    candidates.put(label);
                }
            }
            detail.put("candidates", candidates);
            completeMeasurementRecognition(detail);
        } catch (Exception error) {
            completeMeasurementRecognition(null);
        }
    }

    private void completeMeasurementRecognition(JSONObject detail) {
        if (measurementBatchFiles == null || measurementBatchFiles.size() <= 1) {
            if (detail == null) dispatchMeasurementError("身長と体重を認識できませんでした。");
            else dispatchWebEvent("android-measurement-scanned", detail);
            clearMeasurementBatch();
            return;
        }
        if (detail != null && detail.has("height") && detail.has("weight")) {
            measurementBatchResults.add(detail);
        }
        measurementBatchIndex++;
        if (measurementBatchIndex < measurementBatchFiles.size()) {
            File nextPhoto = measurementBatchFiles.get(measurementBatchIndex);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                measurementPhoto = nextPhoto;
                recognizeMeasurementPhoto();
            }, 120);
            return;
        }
        dispatchMeasurementConsensus();
        clearMeasurementBatch();
    }

    private void dispatchMeasurementConsensus() {
        if (measurementBatchResults.isEmpty()) {
            dispatchMeasurementError("身長と体重を認識できませんでした。もう一度撮影してください。");
            return;
        }
        JSONObject best = measurementBatchResults.get(0);
        int bestCount = 0;
        JSONArray allCandidates = new JSONArray();
        ArrayList<String> uniqueCandidates = new ArrayList<>();
        for (JSONObject candidate : measurementBatchResults) {
            String height = candidate.optString("height");
            String weight = candidate.optString("weight");
            int count = 0;
            for (JSONObject other : measurementBatchResults) {
                if (height.equals(other.optString("height"))
                    && weight.equals(other.optString("weight"))) count++;
            }
            String label = height + "cm / " + weight + "kg";
            if (!uniqueCandidates.contains(label)) {
                uniqueCandidates.add(label);
                allCandidates.put(label);
            }
            if (count > bestCount) {
                best = candidate;
                bestCount = count;
            }
        }
        try {
            JSONObject result = new JSONObject()
                .put("height", best.optString("height"))
                .put("weight", best.optString("weight"))
                .put("requiresReview", bestCount < 2)
                .put("candidates", allCandidates)
                .put("sampleCount", measurementBatchResults.size())
                .put("agreementCount", bestCount);
            Log.i(TAG, "Measurement burst consensus=" + bestCount + "/"
                + measurementBatchResults.size() + " value=" + result.optString("height")
                + "/" + result.optString("weight"));
            dispatchWebEvent("android-measurement-scanned", result);
        } catch (Exception error) {
            dispatchMeasurementError(error.getMessage());
        }
    }

    private void clearMeasurementBatch() {
        measurementBatchFiles = null;
        measurementBatchResults.clear();
        measurementBatchIndex = 0;
    }

    private Measurement extractAd6351DisplayPattern(Text... recognizedTexts) {
        Pattern heightPattern = Pattern.compile("([A-Za-z0-9|.,]{3,6})\\s*cm", Pattern.CASE_INSENSITIVE);
        Pattern weightPattern = Pattern.compile("([A-Za-z0-9|.,]{3,6})\\s*(?:kg|k9|kq)", Pattern.CASE_INSENSITIVE);
        for (int index = recognizedTexts.length - 1; index >= 0; index--) {
            Text text = recognizedTexts[index];
            if (text == null) continue;
            String recognized = text.getText().replaceAll("[\\r\\n]+", " ");
            Matcher heightMatcher = heightPattern.matcher(recognized);
            Matcher weightMatcher = weightPattern.matcher(recognized);
            if (!heightMatcher.find() || !weightMatcher.find()) continue;
            Double height = decodeAd6351Token(heightMatcher.group(1), true);
            Double weight = decodeAd6351Token(weightMatcher.group(1), false);
            if (height != null && weight != null && validHeight(height) && validWeight(weight)) {
                Log.i(TAG, "AD-6351 corrected OCR=" + formatMeasurement(height) + "cm "
                    + formatMeasurement(weight) + "kg from " + heightMatcher.group(1) + "/"
                    + weightMatcher.group(1));
                return new Measurement(height, weight);
            }
        }
        // ML Kit often omits the decimal point and units on seven-segment displays,
        // but preserves the top-to-bottom order (for example 1700 followed by 665).
        // Prefer that clear pair over trying to reconstruct missing leading segments.
        for (Text text : recognizedTexts) {
            Measurement numericPair = extractOrderedDisplayPair(text);
            if (numericPair != null) return numericPair;
        }
        return null;
    }

    private Measurement extractOrderedDisplayPair(Text text) {
        if (text == null) return null;
        List<NumericCandidate> candidates = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                Matcher matcher = DECIMAL_VALUE.matcher(normalizeOcrText(line.getText()));
                while (matcher.find()) {
                    String token = matcher.group(1).replace(',', '.');
                    double raw;
                    try { raw = Double.parseDouble(token); }
                    catch (NumberFormatException ignored) { continue; }
                    candidates.add(new NumericCandidate(raw,
                        box == null ? 0 : box.centerX(), box == null ? 0 : box.centerY(),
                        box == null ? 0 : box.height()));
                }
            }
        }
        candidates.sort(Comparator.comparingInt((NumericCandidate item) -> item.y)
            .thenComparingInt(item -> item.x));
        for (int heightIndex = 0; heightIndex < candidates.size(); heightIndex++) {
            NumericCandidate heightItem = candidates.get(heightIndex);
            Double height = normalizeHeightValue(heightItem.value);
            // The display has one decimal place. Requiring a 4-digit raw height value
            // rejects labels such as the instrument's 100 kg capacity marking.
            boolean heightShape = heightItem.value >= 880.0;
            if (height == null || !heightShape) continue;
            for (int weightIndex = heightIndex + 1; weightIndex < candidates.size(); weightIndex++) {
                NumericCandidate weightItem = candidates.get(weightIndex);
                if (weightItem.y < heightItem.y) continue;
                Double weight = normalizeWeightValue(weightItem.value);
                boolean weightShape = weightItem.value > 150.8;
                if (weight == null || !weightShape) continue;
                Log.i(TAG, "AD-6351 ordered OCR=" + formatMeasurement(height) + "cm "
                    + formatMeasurement(weight) + "kg from " + heightItem.value + "/"
                    + weightItem.value);
                return new Measurement(height, weight);
            }
        }
        return null;
    }

    private Double decodeAd6351Token(String token, boolean height) {
        String raw = token.replace(".", "").replace(",", "");
        int required = height ? 4 : 3;
        if (raw.length() > required) raw = raw.substring(raw.length() - required);
        if (height && raw.length() == 3) raw += "0";
        if (raw.length() != required) return null;
        StringBuilder digits = new StringBuilder();
        for (int index = 0; index < raw.length(); index++) {
            char value = raw.charAt(index);
            char digit;
            if (Character.isDigit(value)) {
                digit = value;
            } else {
                switch (value) {
                    case 'I': case 'i': case 'l': case '|': digit = '1'; break;
                    case 'Z': case 'z': digit = '2'; break;
                    case 'A': case 'a': digit = '4'; break;
                    case 'S': case 's': digit = '5'; break;
                    case 'b': case 'G': digit = '6'; break;
                    case 'T': case 't': digit = '7'; break;
                    case 'B': digit = '8'; break;
                    case 'g': case 'q': digit = '9'; break;
                    case 'O': case 'o': case 'D': digit = '0'; break;
                    case 'U': case 'u':
                        digit = height && index == 1 ? '7' : '0';
                        break;
                    default: return null;
                }
            }
            digits.append(digit);
        }
        try {
            return Double.parseDouble(digits.substring(0, required - 1) + "."
                + digits.substring(required - 1));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private Measurement findRepeatedMeasurement(List<Measurement> measurements) {
        for (int first = 0; first < measurements.size(); first++) {
            int matches = 1;
            for (int second = first + 1; second < measurements.size(); second++) {
                if (sameMeasurement(measurements.get(first), measurements.get(second))) matches++;
            }
            if (matches >= 2) return measurements.get(first);
        }
        return null;
    }

    private PartialMeasurement extractPartialMeasurement(Text... recognizedTexts) {
        Double height = null;
        Double weight = null;
        int heightBox = -1;
        int weightBox = -1;
        for (Text text : recognizedTexts) {
            if (text == null) continue;
            for (Text.TextBlock block : text.getTextBlocks()) {
                for (Text.Line line : block.getLines()) {
                    String normalized = normalizeOcrText(line.getText());
                    String lower = normalized.toLowerCase(Locale.ROOT).replace(" ", "");
                    Rect box = line.getBoundingBox();
                    int boxHeight = box == null ? 0 : box.height();
                    Matcher matcher = DECIMAL_VALUE.matcher(normalized);
                    while (matcher.find()) {
                        double raw;
                        try { raw = Double.parseDouble(matcher.group(1).replace(',', '.')); }
                        catch (NumberFormatException ignored) { continue; }
                        if (lower.contains("cm") && boxHeight > heightBox) {
                            Double value = normalizeHeightValue(raw);
                            if (value != null) { height = value; heightBox = boxHeight; }
                        }
                        if ((lower.contains("kg") || lower.contains("k9") || lower.contains("kq")) && boxHeight > weightBox) {
                            Double value = normalizeWeightValue(raw);
                            if (value != null) { weight = value; weightBox = boxHeight; }
                        }
                    }
                }
            }
        }
        return new PartialMeasurement(height, weight);
    }

    private boolean sameMeasurement(Measurement first, Measurement second) {
        return Math.abs(first.height - second.height) < 0.05 && Math.abs(first.weight - second.weight) < 0.05;
    }

    private void closeMeasurementRecognition(TextRecognizer latinRecognizer, TextRecognizer japaneseRecognizer,
                                              Bitmap original, Bitmap enhanced, Bitmap focused) {
        latinRecognizer.close();
        japaneseRecognizer.close();
        if (!original.isRecycled()) original.recycle();
        if (!enhanced.isRecycled()) enhanced.recycle();
        if (focused != null && !focused.isRecycled()) focused.recycle();
        deleteMeasurementPhoto();
    }

    private Measurement extractMeasurement(Text text) {
        List<NumericCandidate> candidates = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                String normalized = normalizeOcrText(line.getText());
                Rect box = line.getBoundingBox();
                Matcher matcher = DECIMAL_VALUE.matcher(normalized);
                while (matcher.find()) {
                    double value;
                    try { value = Double.parseDouble(matcher.group(1).replace(',', '.')); }
                    catch (NumberFormatException ignored) { continue; }
                    candidates.add(new NumericCandidate(value,
                        box == null ? 0 : box.centerX(), box == null ? 0 : box.centerY(),
                        box == null ? 0 : box.height()));
                }
            }
        }
        if (candidates.isEmpty()) return null;

        int largestTextHeight = candidates.stream().mapToInt(item -> item.boxHeight).max().orElse(0);
        int minimumDisplayHeight = Math.max(12, Math.round(largestTextHeight * 0.55f));
        List<NumericCandidate> display = new ArrayList<>();
        for (NumericCandidate candidate : candidates) {
            if (candidate.boxHeight >= minimumDisplayHeight) display.add(candidate);
        }
        display.sort(Comparator.comparingInt((NumericCandidate item) -> item.y).thenComparingInt(item -> item.x));

        NumericCandidate heightCandidate = null;
        Double height = null;
        for (NumericCandidate item : display) {
            Double value = normalizeHeightValue(item.value);
            if (value != null) {
                heightCandidate = item;
                height = value;
                break;
            }
        }
        if (heightCandidate == null) return null;

        Double weight = null;
        int separateRowDistance = Math.max(8, Math.round(largestTextHeight * 0.35f));
        for (NumericCandidate item : display) {
            if (item.y <= heightCandidate.y + separateRowDistance) continue;
            Double value = normalizeWeightValue(item.value);
            if (value != null) {
                weight = value;
                break;
            }
        }
        return weight == null ? null : new Measurement(height, weight);
    }

    private String normalizeOcrText(String text) {
        String normalized = text.replace('O', '0').replace('o', '0').replace('I', '1').replace('l', '1')
            .replace('|', '1').replace('，', ',').replace('．', '.');
        normalized = normalized.replaceAll("(?<![A-Za-z])[Ss](?=[0-9.,])|(?<=[0-9.,])[Ss](?![A-Za-z])", "5");
        normalized = normalized.replaceAll("(?<![A-Za-z])[Bb](?=[0-9.,])|(?<=[0-9.,])[Bb](?![A-Za-z])", "8");
        return normalized;
    }

    private Double normalizeHeightValue(Double value) {
        if (value == null) return null;
        if (validHeight(value)) return value;
        double shifted = value / 10.0;
        return value >= 880.0 && value <= 2100.0 && validHeight(shifted) ? shifted : null;
    }

    private Double normalizeWeightValue(Double value) {
        if (value == null) return null;
        if (validWeight(value)) return value;
        double shifted = value / 10.0;
        return value > 150.8 && value <= 1508.0 && validWeight(shifted) ? shifted : null;
    }

    private String summarizeRecognizedText(String text) {
        if (text == null) return "";
        String summary = text.replaceAll("\\s+", " ").trim();
        return summary.length() <= 80 ? summary : summary.substring(0, 80) + "...";
    }

    private boolean validHeight(double value) { return value >= 88.0 && value <= 210.0; }
    private boolean validWeight(double value) { return value >= 2.0 && value <= 150.8; }
    private String formatMeasurement(double value) { return String.format(Locale.ROOT, "%.1f", value); }

    private void dispatchMeasurementError(String message) {
        JSONObject detail = new JSONObject();
        try { detail.put("text", message == null ? "身長と体重を認識できませんでした。" : message); } catch (Exception ignored) { }
        dispatchWebEvent("android-measurement-error", detail);
    }

    private void dispatchWebEvent(String eventName, JSONObject detail) {
        String script = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(eventName)
            + ",{detail:" + detail + "}));";
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private void deleteMeasurementPhoto() {
        File photo = measurementPhoto;
        measurementPhoto = null;
        if (photo != null && photo.exists() && !photo.delete()) Log.w(TAG, "Unable to delete measurement photo");
    }

    private static final class NumericCandidate {
        final double value;
        final int x;
        final int y;
        final int boxHeight;
        NumericCandidate(double value, int x, int y, int boxHeight) {
            this.value = value;
            this.x = x;
            this.y = y;
            this.boxHeight = boxHeight;
        }
    }

    private static final class Measurement {
        final double height;
        final double weight;
        Measurement(double height, double weight) { this.height = height; this.weight = weight; }
    }

    private static final class PartialMeasurement {
        final Double height;
        final Double weight;
        PartialMeasurement(Double height, Double weight) { this.height = height; this.weight = weight; }
    }

    private void dispatchBarcodeEvent(String eventName, String text, String format) {
        JSONObject detail = new JSONObject();
        try {
            if (text != null) detail.put("text", text);
            if (format != null) detail.put("format", format);
        } catch (Exception ignored) { }
        dispatchWebEvent(eventName, detail);
    }

    private String feedbackMode() {
        return deviceSettings.getString("card_feedback", "normal");
    }

    private JSONObject saveFeedbackMode(String mode) throws Exception {
        if (!Arrays.asList("silent", "small", "normal", "large", "vibration").contains(mode)) {
            throw new Exception("カード確認音の設定値が不正です。");
        }
        if (!deviceSettings.edit().putString("card_feedback", mode).commit()) {
            throw new Exception("カード確認音の設定を保存できませんでした。");
        }
        return ok().put("mode", mode);
    }

    private void playCardFeedback(String outcome) {
        String mode = feedbackMode();
        if ("silent".equals(mode)) return;
        Vibrator vibrator = getSystemService(Vibrator.class);
        if (vibrator != null && vibrator.hasVibrator()) {
            if ("success".equals(outcome)) {
                vibrator.vibrate(VibrationEffect.createOneShot(45, VibrationEffect.DEFAULT_AMPLITUDE));
            } else if ("warning".equals(outcome)) {
                vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 70, 60, 70}, -1));
            } else {
                vibrator.vibrate(VibrationEffect.createOneShot(220, VibrationEffect.DEFAULT_AMPLITUDE));
            }
        }
        if ("vibration".equals(mode)) return;
        int volume = "small".equals(mode) ? 25 : "large".equals(mode) ? 100 : 60;
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, volume);
            int toneType = "success".equals(outcome) ? ToneGenerator.TONE_PROP_ACK : ToneGenerator.TONE_PROP_NACK;
            int duration = "success".equals(outcome) ? 80 : "warning".equals(outcome) ? 150 : 240;
            tone.startTone(toneType, duration);
            new Handler(Looper.getMainLooper()).postDelayed(tone::release, duration + 120L);
        } catch (RuntimeException ignored) {
            // Vibration still confirms the read when audio output is unavailable.
        }
    }

    private JSONObject readCard() throws Exception {
        return withCard((nfc, idm) -> {
            byte[][] blocks = readBlocks(nfc);
            JSONObject result = ok().put("reader", "Android NFC").put("idm", idm).put("serviceCode", "000B").put("blockCount", BLOCK_COUNT);
            JSONArray list = new JSONArray();
            for (int i = 0; i < blocks.length; i++) list.put(new JSONObject().put("number", i).put("hex", hex(blocks[i])));
            result.put("blocks", list);
            Slot active = activeSlot(blocks);
            result.put("cardData", active == null ? JSONObject.NULL : new JSONObject().put("format", "MEX1").put("slot", active.index).put("sequence", active.sequence).put("payloadHex", hex(active.payload)));
            return result;
        });
    }

    private JSONObject writeCard(JSONObject request) throws Exception {
        if (!request.optBoolean("allowWrite") || !"WRITE_AND_VERIFY".equals(request.optString("confirmation"))) throw new Exception("カード書込みの確認情報がありません。");
        byte[] payload = fromHex(request.optString("payloadHex"));
        if (payload.length > MAX_PAYLOAD) throw new Exception("カード用データが96バイトを超えています。");
        String expectedIdm = request.optString("idm").toUpperCase(Locale.ROOT);
        return withCard((nfc, idm) -> {
            if (!idm.equals(expectedIdm)) throw new Exception("置かれているカードが読み取り時と異なります。");
            byte[][] before = readBlocks(nfc);
            Slot previous = activeSlot(before);
            int slotIndex = previous == null ? 0 : 1 - previous.index;
            long sequence = previous == null ? 1 : Math.min(0xffffffffL, previous.sequence + 1);
            byte[][] planned = encodeSlot(slotIndex, sequence, payload);
            int start = slotIndex * SLOT_BLOCKS;
            for (int local = 1; local < SLOT_BLOCKS; local++) {
                writeBlock(nfc, start + local, planned[local]);
                if (!Arrays.equals(readBlock(nfc, start + local), planned[local])) throw new Exception("データ検証に失敗しました（ブロック" + (start + local) + "）。");
            }
            writeBlock(nfc, start, planned[0]);
            if (!Arrays.equals(readBlock(nfc, start), planned[0])) throw new Exception("確定情報を検証できませんでした。");
            Slot active = activeSlot(readBlocks(nfc));
            if (active == null || active.index != slotIndex || active.sequence != sequence || !Arrays.equals(active.payload, payload)) throw new Exception("書込み後のカード内容が一致しません。");
            return ok().put("written", true).put("idm", idm).put("slot", slotIndex).put("sequence", sequence).put("payloadLength", payload.length).put("crc32", String.format(Locale.ROOT, "%08X", crc32(payload))).put("previousSlot", previous == null ? JSONObject.NULL : previous.index);
        });
    }

    private JSONObject lookupBinding(String idm) throws Exception {
        String value = bindings.getString(idm.toUpperCase(Locale.ROOT), null);
        return ok().put("binding", value == null ? JSONObject.NULL : new JSONObject(value));
    }

    private JSONObject saveBinding(JSONObject body) throws Exception {
        String idm = body.optString("idm").toUpperCase(Locale.ROOT), patientCode = body.optString("patientCode"), groupId = body.optString("groupId");
        if (idm.isEmpty() || patientCode.isEmpty() || groupId.isEmpty()) throw new Exception("カード紐付け情報が不足しています。");
        if (bindings.contains(idm) && !body.optBoolean("overwrite")) throw new Exception("このカードは既に登録されています。");
        JSONObject binding = new JSONObject().put("idm", idm).put("patientCode", patientCode).put("groupId", groupId);
        if (!bindings.edit().putString(idm, binding.toString()).commit()) throw new Exception("カード紐付けを端末に保存できませんでした。");
        return ok().put("binding", binding);
    }

    private interface CardOperation { JSONObject run(NfcF nfc, String idm) throws Exception; }
    private synchronized JSONObject withCard(CardOperation operation) throws Exception {
        Tag tag = currentTag;
        if (tag == null) throw new Exception("FeliCaカードをスマホのNFC位置に当ててください。");
        NfcF nfc = NfcF.get(tag);
        if (nfc == null) throw new Exception("FeliCaカードを認識できません。");
        try { nfc.connect(); nfc.setTimeout(2500); return operation.run(nfc, hex(tag.getId())); }
        catch (Exception error) { currentTag = null; throw new Exception("カード通信に失敗しました。カードを当て直してください。 " + error.getMessage(), error); }
        finally { try { nfc.close(); } catch (Exception ignored) { } }
    }

    private byte[][] readBlocks(NfcF nfc) throws Exception {
        byte[][] blocks = new byte[BLOCK_COUNT][];
        for (int i = 0; i < BLOCK_COUNT; i++) blocks[i] = readBlock(nfc, i);
        return blocks;
    }

    private byte[] readBlock(NfcF nfc, int block) throws Exception {
        byte[] idm = currentTag.getId();
        ByteArrayOutputStream command = new ByteArrayOutputStream();
        command.write(0); command.write(0x06); command.write(idm); command.write(1); command.write(0x0b); command.write(0x00); command.write(1); command.write(0x80); command.write(block);
        byte[] packet = command.toByteArray(); packet[0] = (byte) packet.length;
        byte[] response = nfc.transceive(packet); validateResponse(response, 0x07, idm);
        if (response.length < 29 || (response[12] & 0xff) != 1) throw new Exception("カードの読取り応答が不正です。");
        return Arrays.copyOfRange(response, 13, 29);
    }

    private void writeBlock(NfcF nfc, int block, byte[] data) throws Exception {
        byte[] idm = currentTag.getId();
        ByteArrayOutputStream command = new ByteArrayOutputStream();
        command.write(0); command.write(0x08); command.write(idm); command.write(1); command.write(0x09); command.write(0x00); command.write(1); command.write(0x80); command.write(block); command.write(data);
        byte[] packet = command.toByteArray(); packet[0] = (byte) packet.length;
        validateResponse(nfc.transceive(packet), 0x09, idm);
    }

    private void validateResponse(byte[] response, int command, byte[] idm) throws Exception {
        if (response.length < 12 || (response[1] & 0xff) != command || !Arrays.equals(Arrays.copyOfRange(response, 2, 10), idm) || response[10] != 0 || response[11] != 0) throw new Exception("FeliCa応答エラーです。");
    }

    private static byte[][] encodeSlot(int index, long sequence, byte[] payload) {
        byte[][] blocks = new byte[SLOT_BLOCKS][16];
        System.arraycopy(MAGIC, 0, blocks[0], 0, MAGIC.length); blocks[0][4] = 1; blocks[0][5] = (byte) index;
        putU32(blocks[0], 6, sequence); blocks[0][10] = (byte) payload.length; blocks[0][11] = 1; putU32(blocks[0], 12, crc32(payload));
        for (int i = 0; i < payload.length; i++) blocks[1 + i / 16][i % 16] = payload[i];
        return blocks;
    }

    private static Slot activeSlot(byte[][] blocks) {
        Slot a = decodeSlot(blocks, 0), b = decodeSlot(blocks, 1);
        if (a == null) return b; if (b == null) return a;
        return Long.compareUnsigned(b.sequence, a.sequence) > 0 ? b : a;
    }

    private static Slot decodeSlot(byte[][] blocks, int index) {
        int start = index * SLOT_BLOCKS; byte[] header = blocks[start];
        if (!Arrays.equals(Arrays.copyOfRange(header, 0, 4), MAGIC) || header[4] != 1 || header[5] != index || header[11] != 1) return null;
        int length = header[10] & 0xff; if (length > MAX_PAYLOAD) return null;
        ByteArrayOutputStream payload = new ByteArrayOutputStream();
        for (int i = 1; i < SLOT_BLOCKS; i++) payload.write(blocks[start + i], 0, 16);
        byte[] bytes = Arrays.copyOf(payload.toByteArray(), length);
        return readU32(header, 12) == crc32(bytes) ? new Slot(index, readU32(header, 6), bytes) : null;
    }

    private static final class Slot {
        final int index; final long sequence; final byte[] payload;
        Slot(int index, long sequence, byte[] payload) { this.index = index; this.sequence = sequence; this.payload = payload; }
    }

    private static JSONObject ok() { try { return new JSONObject().put("ok", true); } catch (Exception e) { return new JSONObject(); } }
    private static JSONObject failure(Exception error) { try { return new JSONObject().put("ok", false).put("error", error.getMessage()); } catch (Exception e) { return new JSONObject(); } }
    private static long crc32(byte[] bytes) { CRC32 crc = new CRC32(); crc.update(bytes); return crc.getValue(); }
    private static void putU32(byte[] target, int offset, long value) { ByteBuffer.wrap(target, offset, 4).order(ByteOrder.LITTLE_ENDIAN).putInt((int) value); }
    private static long readU32(byte[] source, int offset) { return Integer.toUnsignedLong(ByteBuffer.wrap(source, offset, 4).order(ByteOrder.LITTLE_ENDIAN).getInt()); }
    private static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(); for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02X", value)); return out.toString(); }
    private static byte[] fromHex(String value) throws Exception { if ((value.length() & 1) != 0) throw new Exception("16進データが不正です。"); byte[] out = new byte[value.length() / 2]; for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16); return out; }

    private void handleBackNavigation() {
        String script = "(() => { const event = new CustomEvent('android-back-request', {cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented; })()";
        webView.evaluateJavascript(script, handled -> {
            if ("true".equals(handled)) return;
            if (webView.canGoBack()) webView.goBack(); else finish();
        });
    }

    @Override public void onBackPressed() {
        handleBackNavigation();
    }
}
