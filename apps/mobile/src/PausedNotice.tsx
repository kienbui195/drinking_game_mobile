import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Copy, Heading, Panel } from './ui';

// Ván chỉ tạm dừng ở phía giao diện: state trên server giữ nguyên, không có hành động nào
// được gửi đi khi lớp phủ này đang hiện.
export function PausedNotice({
  names,
  host,
  onContinue,
}: {
  names: string[];
  host: boolean;
  onContinue: () => void;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onContinue}>
      <SafeAreaView className="flex-1 bg-black/80">
        <View className="flex-1 items-center justify-center p-5">
          <View className="w-full" style={{ maxWidth: 430 }}>
            <Panel>
              <Text className="text-amber-300 text-xs font-bold tracking-widest">
                VÁN ĐANG TẠM DỪNG
              </Text>
              <Heading>
                {names.length === 1
                  ? `${names[0]} đang mất kết nối`
                  : `${names.length} người đang mất kết nối`}
              </Heading>
              {names.length > 1 && (
                <ScrollView style={{ maxHeight: 140 }} showsVerticalScrollIndicator={false}>
                  <View className="gap-2">
                    {names.map((name) => (
                      <Text key={name} className="text-slate-200">
                        ⚪ {name}
                      </Text>
                    ))}
                  </View>
                </ScrollView>
              )}
              <Copy>
                Hiện trạng ván được giữ nguyên: lượt, bài đã mở và thống kê không thay đổi. Ván tự
                chạy tiếp ngay khi mọi người kết nối lại.
              </Copy>
              {host ? (
                <>
                  <Copy>
                    Nếu không chờ được, chủ phòng có thể tiếp tục ván. Người mất kết nối vẫn giữ chỗ
                    và có thể quay lại; dùng “Bỏ lượt hiện tại” nếu ván dừng ở lượt của họ.
                  </Copy>
                  <Button title="Vẫn tiếp tục ván" secondary onPress={onContinue} />
                </>
              ) : (
                <>
                  <Copy>Đang chờ chủ phòng quyết định.</Copy>
                  <Button title="Ẩn cảnh báo" secondary onPress={onContinue} />
                </>
              )}
            </Panel>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
