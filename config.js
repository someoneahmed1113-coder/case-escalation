// إعدادات الاتصال بقاعدة البيانات.
// عند نقل المنصة إلى سيرفر المنشأة (Supabase مستضاف ذاتياً) يكفي تغيير القيمتين أدناه.
// المفتاح العام (anon key) آمن للنشر: الصلاحيات الفعلية محمية بسياسات قاعدة البيانات.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://rnbtrslsyajcfkyezlxo.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuYnRyc2xzeWFqY2ZreWV6bHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNzMwNDIsImV4cCI6MjEwODk0OTA0Mn0.-Y89dPHdeAOiL9STrkg8mekWwdpPBkrHk3KfArVcMjY',
  // وضع العرض التجريبي: يعمل بدون قاعدة بيانات ويحفظ في المتصفح فقط.
  // يتفعّل تلقائياً إذا كانت القيمتان أعلاه فارغتين.
  DEMO: false,
};
