package jp.co.mobileexam.entry;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
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
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONObject;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.Locale;
import java.util.zip.CRC32;

public class MainActivity extends Activity implements NfcAdapter.ReaderCallback {
    private static final String TAG = "MobileExamCamera";
    private static final String APP_URL = "https://mobile-exam-entry-b6w9-z574.onrender.com/";
    private static final String APP_HOST = "mobile-exam-entry-b6w9-z574.onrender.com";
    private static final int BLOCK_COUNT = 14;
    private static final int SLOT_BLOCKS = 7;
    private static final int MAX_PAYLOAD = 96;
    private static final byte[] MAGIC = new byte[]{0x4d, 0x45, 0x58, 0x31};
    private WebView webView;
    private NfcAdapter nfcAdapter;
    private volatile Tag currentTag;
    private SharedPreferences bindings;
    private SharedPreferences deviceSettings;

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
                        return ok().put("barcodeCamera", true).put("nfc", nfcAdapter != null).toString();
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
                scanner.setOrientationLocked(false);
                Log.i(TAG, "Starting CaptureActivity");
                scanner.initiateScan();
            } catch (RuntimeException error) {
                Log.e(TAG, "Unable to start CaptureActivity", error);
                dispatchBarcodeEvent("android-barcode-error", error.getMessage(), null);
            }
        });
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        Log.i(TAG, "Scanner result request=" + requestCode + " result=" + resultCode);
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

    private void dispatchBarcodeEvent(String eventName, String text, String format) {
        JSONObject detail = new JSONObject();
        try {
            if (text != null) detail.put("text", text);
            if (format != null) detail.put("format", format);
        } catch (Exception ignored) { }
        String script = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(eventName)
            + ",{detail:" + detail + "}));";
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
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
