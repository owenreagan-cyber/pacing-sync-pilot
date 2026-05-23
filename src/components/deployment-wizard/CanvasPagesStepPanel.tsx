import PageBuilderPage from '@/pages/PageBuilderPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CanvasPagesStepPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3: Canvas Page HTML Review & Deploy</CardTitle>
      </CardHeader>
      <CardContent>
        <PageBuilderPage />
      </CardContent>
    </Card>
  );
}
