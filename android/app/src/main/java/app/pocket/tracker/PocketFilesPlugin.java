package app.pocket.tracker;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Saves a backup file into the phone's Downloads folder. It writes only the one file it is given, through Android's
 * own file service, so it needs no storage permission and cannot read or list anything else on the phone.
 */
@CapacitorPlugin(name = "PocketFiles")
public class PocketFilesPlugin extends Plugin {

    @PluginMethod
    public void saveText(PluginCall call) {
        String name = call.getString("name");
        String text = call.getString("text");
        if (!FileNames.isSafe(name) || text == null) {
            call.reject("That file name is not valid.");
            return;
        }
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("Saving to Downloads needs Android 10 or newer.");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            call.reject("Could not create the file in Downloads.");
            return;
        }
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IOException("no output");
            out.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            resolver.delete(uri, null, null);
            call.reject("Could not write the file.");
            return;
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, values, null, null);

        JSObject result = new JSObject();
        result.put("name", name);
        call.resolve(result);
    }
}
